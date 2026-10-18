// Package tenanttest is the reusable cross-tenant test kit (P1-03, CLAUDE.md "Đa tổ chức"):
// every module's endpoint tests build a Fixture with two organizations and prove that a member of
// organization A can neither read nor change organization B's data.
//
//	fx := tenanttest.New(t, newHandler)
//	fx.AssertCrossTenantDenied(t, "GET", func(org uuid.UUID) string { return "/api/orgs/" + org.String() + "/devices" }, nil)
package tenanttest

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/testdb"
)

// Fixture: a fresh database, two organizations and one owner in each.
type Fixture struct {
	t      *testing.T
	Pool   *pgxpool.Pool
	Server *httptest.Server
	OrgA   uuid.UUID
	OrgB   uuid.UUID
	A      *Client // owner of OrgA only
	B      *Client // owner of OrgB only
}

// New builds the fixture. newHandler wires the real router (passed in to avoid an import cycle).
func New(t *testing.T, newHandler func(pool *pgxpool.Pool) http.Handler) *Fixture {
	t.Helper()
	pool, _ := testdb.New(t)
	srv := httptest.NewServer(newHandler(pool))
	t.Cleanup(srv.Close)
	fx := &Fixture{t: t, Pool: pool, Server: srv}
	fx.OrgA = fx.NewOrg(t, "Org A")
	fx.OrgB = fx.NewOrg(t, "Org B")
	fx.A = fx.NewUser(t, "owner-a@example.com", false, Member{fx.OrgA, "owner"})
	fx.B = fx.NewUser(t, "owner-b@example.com", false, Member{fx.OrgB, "owner"})
	return fx
}

// Member is one membership to grant when creating a user.
type Member struct {
	Org  uuid.UUID
	Role string
}

// NewOrg inserts an organization directly (no API, no audit).
func (fx *Fixture) NewOrg(t *testing.T, name string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := fx.Pool.QueryRow(context.Background(),
		`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, name).Scan(&id); err != nil {
		t.Fatalf("insert organization: %v", err)
	}
	return id
}

// NewUser creates a user with the given memberships and a signed-in, fully MFA-verified session.
// (MFA rows are inserted directly so tests do not depend on TOTP timing.)
func (fx *Fixture) NewUser(t *testing.T, email string, systemAdmin bool, members ...Member) *Client {
	t.Helper()
	ctx := context.Background()
	var userID uuid.UUID
	if err := fx.Pool.QueryRow(ctx,
		`INSERT INTO users (email, display_name, password_hash, is_system_admin) VALUES ($1::citext, $1::text, 'x', $2) RETURNING id`,
		email, systemAdmin).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	for _, m := range members {
		if _, err := fx.Pool.Exec(ctx,
			`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, m.Org, userID, m.Role); err != nil {
			t.Fatalf("insert membership: %v", err)
		}
	}
	if _, err := fx.Pool.Exec(ctx,
		`INSERT INTO mfa_totp (user_id, secret_ciphertext, wrapped_dek, key_version, enabled_at) VALUES ($1, '\x00', '\x00', 1, now())`,
		userID); err != nil {
		t.Fatalf("insert mfa: %v", err)
	}
	token, _ := auth.NewToken()
	csrf, _ := auth.NewToken()
	if _, err := fx.Pool.Exec(ctx,
		`INSERT INTO sessions (token_hash, user_id, csrf_token, mfa_verified_at, expires_at) VALUES ($1, $2, $3, now(), $4)`,
		auth.HashToken(token), userID, csrf, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("insert session: %v", err)
	}
	return &Client{t: t, base: fx.Server.URL, token: token, csrf: csrf, UserID: userID}
}

// Client sends requests like the browser app: session cookie, CSRF header, same Origin.
type Client struct {
	t      *testing.T
	base   string
	token  string
	csrf   string
	UserID uuid.UUID
}

// Do sends a request and decodes a JSON object body (nil for empty bodies).
func (c *Client) Do(method, path string, body any) (int, map[string]any) {
	c.t.Helper()
	var buf io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		buf = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.base+path, buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", c.base)
	if c.token != "" {
		req.Header.Set("X-CSRF-Token", c.csrf)
		req.AddCookie(&http.Cookie{Name: "ntb_session", Value: c.token})
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

// Raw sends a GET and returns the response with its body read (binary endpoints: images, files).
func (c *Client) Raw(path string) (*http.Response, []byte) {
	c.t.Helper()
	req, _ := http.NewRequest("GET", c.base+path, nil)
	req.Header.Set("Origin", c.base)
	if c.token != "" {
		req.AddCookie(&http.Cookie{Name: "ntb_session", Value: c.token})
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("GET %s: %v", path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(resp.Body)
	return resp, b
}

// AssertCrossTenantDenied: A calling the endpoint for OrgB gets 404 (existence not revealed), while
// B calling it for OrgB is not refused by tenancy (any status except 401/404). Use it for every
// tenant-scoped endpoint; then also assert B's data is unchanged where the method writes.
func (fx *Fixture) AssertCrossTenantDenied(t *testing.T, method string, pathFor func(org uuid.UUID) string, body any) {
	t.Helper()
	if status, resp := fx.A.Do(method, pathFor(fx.OrgB), body); status != http.StatusNotFound {
		t.Errorf("%s %s as member of another org: status %d (%v), want 404", method, pathFor(fx.OrgB), status, resp)
	}
	if status, _ := fx.B.Do(method, pathFor(fx.OrgB), body); status == http.StatusNotFound || status == http.StatusUnauthorized {
		t.Errorf("%s %s as member: status %d — control request failed, the denial above proves nothing", method, pathFor(fx.OrgB), status)
	}
}

// NewAnonymous returns a client without a session (public endpoints, login).
func (fx *Fixture) NewAnonymous() *Client {
	return &Client{t: fx.t, base: fx.Server.URL}
}
