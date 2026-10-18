package api

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func TestCheckRoleChange(t *testing.T) {
	owner := tenant.Membership{Role: tenant.RoleOwner}
	admin := tenant.Membership{Role: tenant.RoleAdmin}
	manager := tenant.Membership{Role: tenant.RoleEditor, Permissions: []string{"user.manage"}}
	editor := tenant.Membership{Role: tenant.RoleEditor}

	cases := []struct {
		name     string
		actor    tenant.Membership
		from, to string
		perms    bool
		allowed  bool
	}{
		{"editor cannot manage", editor, "", "viewer", false, false},
		{"user.manage adds viewer", manager, "", "viewer", false, true},
		{"user.manage cannot add admin", manager, "", "admin", false, false},
		{"user.manage cannot grant permissions", manager, "", "editor", true, false},
		{"user.manage cannot demote admin", manager, "admin", "viewer", false, false},
		{"admin adds admin", admin, "", "admin", false, true},
		{"admin grants permissions", admin, "editor", "editor", true, true},
		{"admin cannot grant owner", admin, "admin", "owner", false, false},
		{"admin cannot remove owner", admin, "owner", "", false, false},
		{"owner grants owner", owner, "admin", "owner", false, true},
		{"owner removes owner", owner, "owner", "", false, true},
	}
	for _, c := range cases {
		if got := checkRoleChange(c.actor, c.from, c.to, c.perms) == ""; got != c.allowed {
			t.Errorf("%s: allowed=%v, want %v", c.name, got, c.allowed)
		}
	}
}

func membersPath(org uuid.UUID) string { return orgPath(org) + "/members" }
func memberPath(org, user uuid.UUID) string {
	return membersPath(org) + "/" + user.String()
}

func memberVersion(t *testing.T, pool *pgxpool.Pool, org, user uuid.UUID) int {
	t.Helper()
	var v int
	if err := pool.QueryRow(context.Background(),
		`SELECT version FROM memberships WHERE organization_id = $1 AND user_id = $2`, org, user).Scan(&v); err != nil {
		t.Fatalf("membership version: %v", err)
	}
	return v
}

// Cross-tenant isolation for every member endpoint (mandatory per CLAUDE.md).
func TestMemberEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	fx.AssertCrossTenantDenied(t, "GET", membersPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", membersPath, map[string]any{"email": "new-b@example.com", "role": "viewer"})

	// A targets B's owner through B's org path → 404 and B's membership is untouched.
	for _, req := range []struct{ method, path string }{
		{"PATCH", memberPath(fx.OrgB, fx.B.UserID)},
		{"DELETE", memberPath(fx.OrgB, fx.B.UserID)},
		{"POST", memberPath(fx.OrgB, fx.B.UserID) + "/invite"},
	} {
		if status, _ := fx.A.Do(req.method, req.path, map[string]any{"role": "viewer", "permissions": []string{}, "version": 1}); status != http.StatusNotFound {
			t.Errorf("%s %s as A: %d, want 404", req.method, req.path, status)
		}
	}
	// A cannot reach B's owner through A's own org path either (not a member of A).
	if status, _ := fx.A.Do("PATCH", memberPath(fx.OrgA, fx.B.UserID), map[string]any{"role": "viewer", "permissions": []string{}, "version": 1}); status != http.StatusNotFound {
		t.Errorf("PATCH foreign user via own org: %d, want 404", status)
	}
	var role string
	_ = fx.Pool.QueryRow(context.Background(), `SELECT role FROM memberships WHERE user_id = $1`, fx.B.UserID).Scan(&role)
	if role != "owner" {
		t.Fatalf("B's role changed by another tenant: %s", role)
	}
}

func TestAddMemberInviteAcceptAndLogin(t *testing.T) {
	fx := newOrgFixture(t)
	status, body := fx.A.Do("POST", membersPath(fx.OrgA), map[string]any{"email": "new.user@example.com", "role": "editor"})
	if status != http.StatusCreated {
		t.Fatalf("add: %d %v", status, body)
	}
	token, _ := body["inviteToken"].(string)
	member := body["member"].(map[string]any)
	if token == "" || member["pendingInvite"] != true || member["role"] != "editor" {
		t.Fatalf("invite result = %v", body)
	}
	// Token is not stored in plaintext.
	var leaked int
	_ = fx.Pool.QueryRow(context.Background(), `SELECT count(*) FROM user_tokens WHERE token_hash = $1`, []byte(token)).Scan(&leaked)
	if leaked != 0 {
		t.Fatal("raw invite token stored")
	}

	anon := fx.NewAnonymous()
	status, info := anon.Do("GET", "/api/account-tokens/"+token, nil)
	if status != 200 || info["email"] != "new.user@example.com" || info["purpose"] != "invite" {
		t.Fatalf("inspect: %d %v", status, info)
	}
	if status, _ := anon.Do("POST", "/api/account-tokens/"+token, map[string]any{"password": "short"}); status != http.StatusBadRequest {
		t.Fatalf("weak password: %d, want 400", status)
	}
	// Login is impossible before accepting (no password exists yet).
	if status, _ := anon.Do("POST", "/api/auth/login", map[string]any{"email": "new.user@example.com", "password": ""}); status != http.StatusUnauthorized {
		t.Fatalf("login before accept: %d, want 401", status)
	}
	if status, _ := anon.Do("POST", "/api/account-tokens/"+token, map[string]any{"displayName": "Người Mới", "password": "a-strong-password"}); status != http.StatusNoContent {
		t.Fatalf("accept: %d", status)
	}
	if status, _ := anon.Do("POST", "/api/account-tokens/"+token, map[string]any{"password": "another-password-1"}); status != http.StatusNotFound {
		t.Fatalf("token reused: %d, want 404", status)
	}
	status, login := anon.Do("POST", "/api/auth/login", map[string]any{"email": "new.user@example.com", "password": "a-strong-password"})
	if status != 200 || login["user"].(map[string]any)["displayName"] != "Người Mới" {
		t.Fatalf("login after accept: %d %v", status, login)
	}
	if n := auditCount(t, fx.Pool, "member.add", fx.OrgA); n != 1 {
		t.Fatalf("member.add audit = %d", n)
	}
}

func TestAddExistingUserAndDuplicates(t *testing.T) {
	fx := newOrgFixture(t)
	// B's owner (an active user) is added to A directly — no invite token.
	status, body := fx.A.Do("POST", membersPath(fx.OrgA), map[string]any{"email": "owner-b@example.com", "role": "viewer"})
	if status != http.StatusCreated || body["inviteToken"] != nil {
		t.Fatalf("add existing: %d %v", status, body)
	}
	if status, _ := fx.A.Do("POST", membersPath(fx.OrgA), map[string]any{"email": "OWNER-B@example.com", "role": "viewer"}); status != http.StatusConflict {
		t.Fatalf("duplicate (case-insensitive): %d, want 409", status)
	}
	for _, bad := range []map[string]any{
		{"email": "not-an-email", "role": "viewer"},
		{"email": "x@example.com", "role": "superuser"},
		{"email": "x@example.com", "role": "viewer", "permissions": []string{"root"}},
	} {
		if status, _ := fx.A.Do("POST", membersPath(fx.OrgA), bad); status != http.StatusBadRequest {
			t.Errorf("%v: %d, want 400", bad, status)
		}
	}
}

// Attack: org A holds the invite link for a pending user; org B must not be able to add that same
// pending user, otherwise A's admin could activate the account and walk into B.
func TestPendingInviteCannotSpanOrganizations(t *testing.T) {
	fx := newOrgFixture(t)
	_, body := fx.A.Do("POST", membersPath(fx.OrgA), map[string]any{"email": "pending@example.com", "role": "viewer"})
	if body["inviteToken"] == nil {
		t.Fatal("no invite token")
	}
	if status, _ := fx.B.Do("POST", membersPath(fx.OrgB), map[string]any{"email": "pending@example.com", "role": "viewer"}); status != http.StatusConflict {
		t.Fatalf("B adding A's pending invitee: %d, want 409", status)
	}
}

func TestRoleRulesAndLastOwner(t *testing.T) {
	fx := newOrgFixture(t)
	admin := fx.NewUser(t, "admin-a@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: "admin"})
	viewer := fx.NewUser(t, "viewer-a@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: "viewer"})

	patch := func(c *tenanttest.Client, target uuid.UUID, role string, perms []string) int {
		status, _ := c.Do("PATCH", memberPath(fx.OrgA, target), map[string]any{
			"role": role, "permissions": perms, "version": memberVersion(t, fx.Pool, fx.OrgA, target),
		})
		return status
	}
	if s := patch(viewer, admin.UserID, "viewer", []string{}); s != http.StatusForbidden {
		t.Errorf("viewer demoting admin: %d, want 403", s)
	}
	if s := patch(admin, fx.A.UserID, "admin", []string{}); s != http.StatusForbidden {
		t.Errorf("admin demoting owner: %d, want 403", s)
	}
	if s := patch(admin, viewer.UserID, "owner", []string{}); s != http.StatusForbidden {
		t.Errorf("admin granting owner: %d, want 403", s)
	}
	if s := patch(admin, viewer.UserID, "editor", []string{"credential.reveal"}); s != http.StatusOK {
		t.Errorf("admin promoting viewer with permission: %d, want 200", s)
	}
	if s := patch(fx.A, fx.A.UserID, "admin", []string{}); s != http.StatusConflict {
		t.Errorf("last owner demoting self: %d, want 409", s)
	}
	if status, _ := fx.A.Do("DELETE", memberPath(fx.OrgA, fx.A.UserID), nil); status != http.StatusConflict {
		t.Errorf("last owner leaving: %d, want 409", status)
	}
	// A second owner whose account is disabled does not count: nobody could sign in to run the organization.
	owner2 := fx.NewUser(t, "owner2-a@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: "owner"})
	if _, err := fx.Pool.Exec(context.Background(), "UPDATE users SET disabled_at = now() WHERE id = $1", owner2.UserID); err != nil {
		t.Fatal(err)
	}
	if s := patch(fx.A, fx.A.UserID, "admin", []string{}); s != http.StatusConflict {
		t.Errorf("last active owner demoting self next to a disabled owner: %d, want 409", s)
	}
	// Stale version → 409.
	if status, _ := admin.Do("PATCH", memberPath(fx.OrgA, viewer.UserID), map[string]any{"role": "viewer", "permissions": []string{}, "version": 1}); status != http.StatusConflict {
		t.Errorf("stale version: %d, want 409", status)
	}
	// Anyone may leave; afterwards the org is gone for them.
	if status, _ := viewer.Do("DELETE", memberPath(fx.OrgA, viewer.UserID), nil); status != http.StatusNoContent {
		t.Fatalf("leave: %d", status)
	}
	if status, _ := viewer.Do("GET", orgPath(fx.OrgA), nil); status != http.StatusNotFound {
		t.Fatalf("former member still has access: %d", status)
	}
	for _, action := range []string{"member.update", "member.remove"} {
		if n := auditCount(t, fx.Pool, action, fx.OrgA); n != 1 {
			t.Errorf("%s audit = %d, want 1", action, n)
		}
	}
}

func TestCredentialRevealRequiresMFA(t *testing.T) {
	fx := newOrgFixture(t)
	editor := fx.NewUser(t, "ed@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: "editor"})
	_, me := editor.Do("GET", "/api/auth/me", nil)
	if me["mfa"].(map[string]any)["required"] != false {
		t.Fatalf("plain editor should not require MFA: %v", me["mfa"])
	}
	status, _ := fx.A.Do("PATCH", memberPath(fx.OrgA, editor.UserID), map[string]any{
		"role": "editor", "permissions": []string{"credential.reveal"}, "version": memberVersion(t, fx.Pool, fx.OrgA, editor.UserID),
	})
	if status != 200 {
		t.Fatalf("grant: %d", status)
	}
	_, me = editor.Do("GET", "/api/auth/me", nil)
	if me["mfa"].(map[string]any)["required"] != true {
		t.Fatalf("credential.reveal holder must require MFA: %v", me["mfa"])
	}
}

func TestRegenerateInvite(t *testing.T) {
	fx := newOrgFixture(t)
	_, body := fx.A.Do("POST", membersPath(fx.OrgA), map[string]any{"email": "late@example.com", "role": "viewer"})
	first := body["inviteToken"].(string)
	userID := uuid.MustParse(body["member"].(map[string]any)["userId"].(string))

	status, regen := fx.A.Do("POST", memberPath(fx.OrgA, userID)+"/invite", nil)
	second, _ := regen["inviteToken"].(string)
	if status != 200 || second == "" || second == first {
		t.Fatalf("regenerate: %d %v", status, regen)
	}
	anon := fx.NewAnonymous()
	if status, _ := anon.Do("GET", "/api/account-tokens/"+first, nil); status != http.StatusNotFound {
		t.Fatalf("old link still valid: %d", status)
	}
	if status, _ := anon.Do("GET", "/api/account-tokens/"+second, nil); status != 200 {
		t.Fatalf("new link invalid: %d", status)
	}
	// Active users have no invite to regenerate.
	if status, _ := fx.A.Do("POST", memberPath(fx.OrgA, fx.A.UserID)+"/invite", nil); status != http.StatusConflict {
		t.Fatalf("regenerate for active user: %d, want 409", status)
	}
}

func TestAdminUserManagement(t *testing.T) {
	fx := newOrgFixture(t)
	root := fx.NewUser(t, "root@example.com", true)
	editor := fx.NewUser(t, "ed@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: "editor"})

	// Org owners cannot use the global user tools (could take over users of other orgs).
	for _, path := range []string{"/disable", "/reset-mfa", "/password-reset"} {
		if status, _ := fx.A.Do("POST", "/api/admin/users/"+editor.UserID.String()+path, nil); status != http.StatusForbidden {
			t.Errorf("owner %s: %d, want 403", path, status)
		}
	}
	status, list := root.Do("GET", "/api/admin/users", nil)
	if status != 200 || len(list["users"].([]any)) != 4 {
		t.Fatalf("list users: %d %v", status, list)
	}

	if status, _ := root.Do("POST", "/api/admin/users/"+root.UserID.String()+"/disable", nil); status != http.StatusConflict {
		t.Fatalf("self-disable: %d, want 409", status)
	}
	if status, _ := root.Do("POST", "/api/admin/users/"+editor.UserID.String()+"/disable", nil); status != http.StatusNoContent {
		t.Fatalf("disable: %d", status)
	}
	if status, _ := editor.Do("GET", "/api/auth/me", nil); status != http.StatusUnauthorized {
		t.Fatalf("disabled user's session still works: %d", status)
	}
	if status, _ := root.Do("POST", "/api/admin/users/"+editor.UserID.String()+"/enable", nil); status != http.StatusNoContent {
		t.Fatalf("enable: %d", status)
	}

	// Reset MFA removes enrollment and signs the user out.
	if status, _ := root.Do("POST", "/api/admin/users/"+fx.A.UserID.String()+"/reset-mfa", nil); status != http.StatusNoContent {
		t.Fatalf("reset mfa: %d", status)
	}
	var totp int
	_ = fx.Pool.QueryRow(context.Background(), `SELECT count(*) FROM mfa_totp WHERE user_id = $1`, fx.A.UserID).Scan(&totp)
	if totp != 0 {
		t.Fatal("TOTP row survived reset")
	}
	if status, _ := fx.A.Do("GET", "/api/auth/me", nil); status != http.StatusUnauthorized {
		t.Fatalf("session survived MFA reset: %d", status)
	}

	// Password reset link → new password works.
	status, reset := root.Do("POST", "/api/admin/users/"+editor.UserID.String()+"/password-reset", nil)
	token, _ := reset["resetToken"].(string)
	if status != 200 || token == "" {
		t.Fatalf("password reset: %d %v", status, reset)
	}
	anon := fx.NewAnonymous()
	_, info := anon.Do("GET", "/api/account-tokens/"+token, nil)
	if info["purpose"] != "password_reset" {
		t.Fatalf("purpose = %v", info["purpose"])
	}
	if status, _ := anon.Do("POST", "/api/account-tokens/"+token, map[string]any{"password": "brand-new-password"}); status != http.StatusNoContent {
		t.Fatalf("accept reset: %d", status)
	}
	if status, _ := anon.Do("POST", "/api/auth/login", map[string]any{"email": "ed@example.com", "password": "brand-new-password"}); status != 200 {
		t.Fatalf("login with new password: %d", status)
	}
	var actions string
	_ = fx.Pool.QueryRow(context.Background(),
		`SELECT string_agg(action, ',' ORDER BY id) FROM audit_log WHERE action LIKE 'user.%' OR action LIKE 'account.%'`).Scan(&actions)
	for _, want := range []string{"user.disable", "user.enable", "user.mfa_reset", "user.password_reset_issued", "account.password_reset"} {
		if !strings.Contains(actions, want) {
			t.Errorf("audit missing %s (got %s)", want, actions)
		}
	}
}

// Decision 2026-10-18: nobody raises their own role or permissions, and below owner nobody grants a role above their
// own or touches someone ranked above them — a raise always comes from higher up (owner / system administrator).
func TestNoSelfOrUpwardRaise(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	mgr := fx.NewUser(t, "viewer-mgr@example.com", false, tenanttest.Member{Org: org, Role: "viewer", Permissions: []string{"user.manage"}})
	edMgr := fx.NewUser(t, "editor-mgr@example.com", false, tenanttest.Member{Org: org, Role: "editor", Permissions: []string{"user.manage"}})
	admin := fx.NewUser(t, "admin-raise@example.com", false, tenanttest.Member{Org: org, Role: "admin"})
	viewer := fx.NewUser(t, "plain-viewer@example.com", false, tenanttest.Member{Org: org, Role: "viewer"})
	patch := func(c *tenanttest.Client, target uuid.UUID, role string, perms []string) int {
		status, _ := c.Do("PATCH", memberPath(org, target), map[string]any{
			"role": role, "permissions": perms, "version": memberVersion(t, fx.Pool, org, target),
		})
		return status
	}
	if s := patch(mgr, mgr.UserID, "editor", []string{"user.manage"}); s != http.StatusForbidden {
		t.Errorf("viewer with user.manage raising self to editor: %d, want 403", s)
	}
	if s := patch(mgr, viewer.UserID, "editor", []string{}); s != http.StatusForbidden {
		t.Errorf("viewer with user.manage making someone editor: %d, want 403", s)
	}
	if s := patch(mgr, edMgr.UserID, "viewer", []string{"user.manage"}); s != http.StatusForbidden {
		t.Errorf("viewer with user.manage demoting an editor: %d, want 403", s)
	}
	if status, _ := mgr.Do("POST", membersPath(org), map[string]any{"email": "new-ed@example.com", "role": "editor"}); status != http.StatusForbidden {
		t.Errorf("viewer with user.manage inviting an editor: %d, want 403", status)
	}
	if s := patch(admin, admin.UserID, "admin", []string{"credential.reveal"}); s != http.StatusForbidden {
		t.Errorf("admin giving self a permission: %d, want 403", s)
	}
	// Within one's own rank it still works, and stepping down oneself is fine.
	if s := patch(edMgr, viewer.UserID, "editor", []string{}); s != http.StatusOK {
		t.Errorf("editor with user.manage making a viewer editor: %d, want 200", s)
	}
	if s := patch(mgr, mgr.UserID, "viewer", []string{}); s != http.StatusOK {
		t.Errorf("dropping one's own permission: %d, want 200", s)
	}
	if s := patch(fx.A, admin.UserID, "admin", []string{"credential.reveal"}); s != http.StatusOK {
		t.Errorf("owner granting a permission: %d, want 200", s)
	}
}

// Review 2026-10-18: a new invite link hands over the account with its role, so issuing one follows the invite rules —
// a viewer with user.manage cannot take a pending owner's (or admin's, or permission holder's) account this way.
func TestRegenerateInviteFollowsRoleRules(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	mgr := fx.NewUser(t, "regen-mgr@example.com", false, tenanttest.Member{Org: org, Role: "viewer", Permissions: []string{"user.manage"}})
	invite := func(email, role string, perms []string) uuid.UUID {
		_, body := fx.A.Do("POST", membersPath(org), map[string]any{"email": email, "role": role, "permissions": perms})
		return uuid.MustParse(body["member"].(map[string]any)["userId"].(string))
	}
	owner := invite("pending-owner@example.com", "owner", []string{})
	admin := invite("pending-admin@example.com", "admin", []string{})
	revealer := invite("pending-rev@example.com", "viewer", []string{"credential.reveal"})
	viewer := invite("pending-viewer@example.com", "viewer", []string{})
	for name, id := range map[string]uuid.UUID{"owner": owner, "admin": admin, "permission holder": revealer} {
		if status, body := mgr.Do("POST", memberPath(org, id)+"/invite", nil); status != http.StatusForbidden || body["inviteToken"] != nil {
			t.Errorf("viewer with user.manage regenerating a pending %s: %d %v", name, status, body)
		}
	}
	if status, _ := mgr.Do("POST", memberPath(org, viewer)+"/invite", nil); status != http.StatusOK {
		t.Errorf("regenerating a pending viewer: %d", status)
	}
	if status, _ := fx.A.Do("POST", memberPath(org, owner)+"/invite", nil); status != http.StatusOK {
		t.Errorf("owner regenerating a pending owner: %d", status)
	}
}
