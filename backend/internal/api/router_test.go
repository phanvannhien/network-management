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

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/testdb"
)

var cheapArgon = auth.Argon2Params{MemoryKiB: 1024, Iterations: 1, Parallelism: 1, SaltLength: 16, KeyLength: 32}

type fakePinger struct{ err error }

func (f fakePinger) Ping(context.Context) (int32, error) { return 1, f.err }

func newRouter(t *testing.T, db Pinger, q store.Querier) http.Handler {
	t.Helper()
	logger := slog.New(slog.DiscardHandler)
	svc, err := auth.NewService(q, logger, cheapArgon)
	if err != nil {
		t.Fatalf("auth service: %v", err)
	}
	resolver, _ := auth.NewClientIPResolver("127.0.0.1/32")
	return NewRouter(logger, NewServer(logger, db, svc, "test"), resolver)
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
	h := newRouter(t, q, q)
	seed, _ := auth.NewService(q, slog.New(slog.DiscardHandler), cheapArgon)
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
	c := newClient(t, newRouter(t, q, q))
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
	c := newClient(t, newRouter(t, q, q))
	if resp, body := c.do("GET", "/api/healthz", nil, nil); resp.StatusCode != 200 || body["database"] != "ok" {
		t.Fatalf("status=%d body=%v", resp.StatusCode, body)
	}
}
