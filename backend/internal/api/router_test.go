package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pquerna/otp/totp"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/secrets"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/testdb"
)

var cheapArgon = auth.Argon2Params{MemoryKiB: 1024, Iterations: 1, Parallelism: 1, SaltLength: 16, KeyLength: 32}

type fakePinger struct{ err error }

func (f fakePinger) Ping(context.Context) (int32, error) { return 1, f.err }

func testKeyring(t *testing.T) *secrets.Keyring {
	t.Helper()
	k, err := secrets.NewKeyring(bytes.Repeat([]byte{7}, secrets.KeySize))
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}
	return k
}

func newRouter(t *testing.T, db Pinger, pool *pgxpool.Pool) http.Handler {
	t.Helper()
	logger := slog.New(slog.DiscardHandler)
	svc, err := auth.NewService(pool, testKeyring(t), logger, cheapArgon)
	if err != nil {
		t.Fatalf("auth service: %v", err)
	}
	resolver, _ := auth.NewClientIPResolver("127.0.0.1/32")
	return NewRouter(logger, NewServer(logger, db, pool, svc, "test"), resolver)
}

// client wraps an httptest server with a cookie jar, like a browser tab.
type client struct {
	t    *testing.T
	srv  *httptest.Server
	http *http.Client
}

func newClient(t *testing.T, h http.Handler) *client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	return &client{t: t, srv: srv, http: &http.Client{Jar: jar}}
}

func (c *client) do(method, path string, body any, headers map[string]string) (*http.Response, map[string]any) {
	c.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, c.srv.URL+path, &buf)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

func TestHealthzOK(t *testing.T) {
	c := newClient(t, newRouter(t, fakePinger{}, nil))
	resp, body := c.do("GET", "/api/healthz", nil, nil)
	if resp.StatusCode != 200 || body["database"] != "ok" || body["status"] != "ok" {
		t.Fatalf("status=%d body=%v", resp.StatusCode, body)
	}
}

func TestHealthzDatabaseDown(t *testing.T) {
	c := newClient(t, newRouter(t, fakePinger{err: errors.New("connection refused")}, nil))
	resp, body := c.do("GET", "/api/healthz", nil, nil)
	if resp.StatusCode != 503 || body["status"] != "degraded" || body["database"] != "unavailable" {
		t.Fatalf("status=%d body=%v", resp.StatusCode, body)
	}
}

func TestUnknownRouteIs404(t *testing.T) {
	c := newClient(t, newRouter(t, fakePinger{}, nil))
	if resp, _ := c.do("GET", "/api/does-not-exist", nil, nil); resp.StatusCode != 404 {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestMeWithoutSessionIs401(t *testing.T) {
	c := newClient(t, newRouter(t, fakePinger{}, nil))
	if resp, _ := c.do("GET", "/api/auth/me", nil, nil); resp.StatusCode != 401 {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

// Full browser-like flow against a real database (P1-01).
func TestLoginSessionLogoutFlow(t *testing.T) {
	pool, _ := testdb.New(t)
	q := store.New(pool)
	h := newRouter(t, q, pool)
	seed, _ := auth.NewService(pool, testKeyring(t), slog.New(slog.DiscardHandler), cheapArgon)
	if _, err := seed.CreateUser(context.Background(), "admin@example.com", "Admin", "a-strong-password", true); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	c := newClient(t, h)

	// Wrong password: generic 401, no cookie.
	resp, body := c.do("POST", "/api/auth/login", map[string]string{"email": "admin@example.com", "password": "nope"}, nil)
	if resp.StatusCode != 401 || !strings.Contains(body["message"].(string), "không đúng") {
		t.Fatalf("wrong password: status=%d body=%v", resp.StatusCode, body)
	}
	if len(resp.Cookies()) != 0 {
		t.Fatal("cookie set on failed login")
	}

	// Correct password: cookie is HttpOnly + SameSite=Lax; body has user + CSRF token.
	resp, body = c.do("POST", "/api/auth/login", map[string]string{"email": "admin@example.com", "password": "a-strong-password"}, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("login: status=%d body=%v", resp.StatusCode, body)
	}
	setCookie := resp.Header.Get("Set-Cookie")
	for _, attr := range []string{"ntb_session=", "HttpOnly", "SameSite=Lax", "Path=/"} {
		if !strings.Contains(setCookie, attr) {
			t.Fatalf("Set-Cookie %q missing %s", setCookie, attr)
		}
	}
	csrf, _ := body["csrfToken"].(string)
	user, _ := body["user"].(map[string]any)
	if csrf == "" || user["email"] != "admin@example.com" || user["isSystemAdmin"] != true {
		t.Fatalf("login body = %v", body)
	}

	// Session cookie authenticates /auth/me.
	resp, body = c.do("GET", "/api/auth/me", nil, nil)
	if resp.StatusCode != 200 || body["csrfToken"] != csrf {
		t.Fatalf("me: status=%d body=%v", resp.StatusCode, body)
	}

	// Logout without / with a wrong CSRF token is refused.
	if resp, _ := c.do("POST", "/api/auth/logout", nil, nil); resp.StatusCode != 403 {
		t.Fatalf("logout without CSRF: status = %d, want 403", resp.StatusCode)
	}
	if resp, _ := c.do("POST", "/api/auth/logout", nil, map[string]string{"X-CSRF-Token": "forged"}); resp.StatusCode != 403 {
		t.Fatalf("logout with forged CSRF: status = %d, want 403", resp.StatusCode)
	}

	// Correct CSRF token: 204 and the cookie is cleared.
	resp, _ = c.do("POST", "/api/auth/logout", nil, map[string]string{"X-CSRF-Token": csrf})
	if resp.StatusCode != 204 || !strings.Contains(resp.Header.Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("logout: status=%d Set-Cookie=%q", resp.StatusCode, resp.Header.Get("Set-Cookie"))
	}
	if resp, _ := c.do("GET", "/api/auth/me", nil, nil); resp.StatusCode != 401 {
		t.Fatalf("me after logout: status = %d, want 401", resp.StatusCode)
	}
}

func TestCrossOriginWriteIsBlocked(t *testing.T) {
	pool, _ := testdb.New(t)
	q := store.New(pool)
	c := newClient(t, newRouter(t, q, pool))
	creds := map[string]string{"email": "x@example.com", "password": "whatever-123"}

	resp, _ := c.do("POST", "/api/auth/login", creds, map[string]string{"Origin": "https://evil.example"})
	if resp.StatusCode != 403 {
		t.Fatalf("cross-origin login: status = %d, want 403", resp.StatusCode)
	}
	resp, _ = c.do("POST", "/api/auth/login", creds, map[string]string{"Sec-Fetch-Site": "cross-site"})
	if resp.StatusCode != 403 {
		t.Fatalf("Sec-Fetch-Site cross-site: status = %d, want 403", resp.StatusCode)
	}
	// Same-origin request is processed normally (unknown user → 401).
	resp, _ = c.do("POST", "/api/auth/login", creds, map[string]string{"Origin": c.srv.URL})
	if resp.StatusCode != 401 {
		t.Fatalf("same-origin login: status = %d, want 401", resp.StatusCode)
	}
}

func TestMalformedLoginBodyIs400WithoutInternals(t *testing.T) {
	c := newClient(t, newRouter(t, fakePinger{}, nil))
	req, _ := http.NewRequest("POST", c.srv.URL+"/api/auth/login", strings.NewReader("{not json"))
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var body map[string]string
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if resp.StatusCode != 400 || body["message"] != "Yêu cầu không hợp lệ" {
		t.Fatalf("status=%d body=%v", resp.StatusCode, body)
	}
}

func TestHealthzWithRealDatabase(t *testing.T) {
	pool, _ := testdb.New(t)
	q := store.New(pool)
	c := newClient(t, newRouter(t, q, pool))
	if resp, body := c.do("GET", "/api/healthz", nil, nil); resp.StatusCode != 200 || body["database"] != "ok" {
		t.Fatalf("status=%d body=%v", resp.StatusCode, body)
	}
}

// ADR-019: a system admin without MFA can only reach the enrollment endpoints until MFA is set up.
func TestMFAGateForcesAdminEnrollment(t *testing.T) {
	pool, _ := testdb.New(t)
	q := store.New(pool)
	seed, _ := auth.NewService(pool, testKeyring(t), slog.New(slog.DiscardHandler), cheapArgon)
	if _, err := seed.CreateUser(context.Background(), "root@example.com", "Root", "a-strong-password", true); err != nil {
		t.Fatalf("seed: %v", err)
	}
	c := newClient(t, newRouter(t, q, pool))

	resp, body := c.do("POST", "/api/auth/login", map[string]string{"email": "root@example.com", "password": "a-strong-password"}, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("login: %d %v", resp.StatusCode, body)
	}
	csrf := body["csrfToken"].(string)
	mfa := body["mfa"].(map[string]any)
	if mfa["required"] != true || mfa["enabled"] != false {
		t.Fatalf("mfa status = %v", mfa)
	}
	h := map[string]string{"X-CSRF-Token": csrf}

	// Not on the enrollment allowlist → blocked by the gate.
	if resp, _ := c.do("POST", "/api/auth/mfa/disable", map[string]string{"code": "123456"}, h); resp.StatusCode != 403 {
		t.Fatalf("disable before enrollment: status = %d, want 403", resp.StatusCode)
	}
	// Enrollment endpoints are reachable.
	resp, body = c.do("POST", "/api/auth/mfa/setup", nil, h)
	if resp.StatusCode != 200 || !strings.HasPrefix(body["qrCode"].(string), "data:image/png;base64,") {
		t.Fatalf("setup: %d", resp.StatusCode)
	}
	secret := body["secret"].(string)
	code, _ := totp.GenerateCode(secret, time.Now())
	resp, body = c.do("POST", "/api/auth/mfa/enable", map[string]string{"code": code}, h)
	if resp.StatusCode != 200 || len(body["recoveryCodes"].([]any)) != 10 {
		t.Fatalf("enable: %d %v", resp.StatusCode, body)
	}

	// Session is now fully verified.
	resp, body = c.do("GET", "/api/auth/me", nil, nil)
	mfa = body["mfa"].(map[string]any)
	if resp.StatusCode != 200 || mfa["enabled"] != true || mfa["verified"] != true {
		t.Fatalf("me after enable: %d %v", resp.StatusCode, body)
	}
	// Mandatory MFA cannot be disabled (reaches the handler now, which refuses).
	if resp, _ := c.do("POST", "/api/auth/mfa/disable", map[string]string{"code": "123456"}, h); resp.StatusCode != 403 {
		t.Fatalf("disable mandatory MFA: status = %d, want 403", resp.StatusCode)
	}
}

// A user with MFA enabled who has only entered the password is limited to /auth/me, logout and verify.
func TestMFAGatePendingVerification(t *testing.T) {
	pool, _ := testdb.New(t)
	q := store.New(pool)
	svc, _ := auth.NewService(pool, testKeyring(t), slog.New(slog.DiscardHandler), cheapArgon)
	ctx := context.Background()
	if _, err := svc.CreateUser(ctx, "u@example.com", "U", "a-strong-password", false); err != nil {
		t.Fatalf("seed: %v", err)
	}
	c := newClient(t, newRouter(t, q, pool))

	// Enroll in a first session.
	_, body := c.do("POST", "/api/auth/login", map[string]string{"email": "u@example.com", "password": "a-strong-password"}, nil)
	h := map[string]string{"X-CSRF-Token": body["csrfToken"].(string)}
	_, body = c.do("POST", "/api/auth/mfa/setup", nil, h)
	secret := body["secret"].(string)
	enrollCode, _ := totp.GenerateCode(secret, time.Now())
	if resp, _ := c.do("POST", "/api/auth/mfa/enable", map[string]string{"code": enrollCode}, h); resp.StatusCode != 200 {
		t.Fatalf("enable: %d", resp.StatusCode)
	}

	// Second browser: password only → pending.
	c2 := newClient(t, newRouter(t, q, pool))
	_, body = c2.do("POST", "/api/auth/login", map[string]string{"email": "u@example.com", "password": "a-strong-password"}, nil)
	h2 := map[string]string{"X-CSRF-Token": body["csrfToken"].(string)}
	if mfa := body["mfa"].(map[string]any); mfa["enabled"] != true || mfa["verified"] != false {
		t.Fatalf("pending status = %v", mfa)
	}
	if resp, _ := c2.do("POST", "/api/auth/mfa/setup", nil, h2); resp.StatusCode != 403 {
		t.Fatalf("setup while pending verification: status = %d, want 403", resp.StatusCode)
	}
	if resp, _ := c2.do("POST", "/api/auth/mfa/verify", map[string]string{"code": "000000"}, h2); resp.StatusCode != 401 {
		t.Fatalf("wrong code: status = %d, want 401", resp.StatusCode)
	}
	next, _ := totp.GenerateCode(secret, time.Now().Add(30*time.Second)) // next step (enroll step is spent)
	resp, body := c2.do("POST", "/api/auth/mfa/verify", map[string]string{"code": next}, h2)
	if resp.StatusCode != 200 || body["mfa"].(map[string]any)["verified"] != true {
		t.Fatalf("verify: %d %v", resp.StatusCode, body)
	}
}
