package api

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func newOrgFixture(t *testing.T) *tenanttest.Fixture {
	return tenanttest.New(t, func(pool *pgxpool.Pool) http.Handler {
		return newRouter(t, store.New(pool), pool)
	})
}

func orgPath(org uuid.UUID) string { return "/api/orgs/" + org.String() }

func auditCount(t *testing.T, pool *pgxpool.Pool, action string, org uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM audit_log WHERE action = $1 AND organization_id = $2`, action, org).Scan(&n); err != nil {
		t.Fatalf("count audit: %v", err)
	}
	return n
}

// Cross-tenant isolation for every organization endpoint (CLAUDE.md: mandatory per endpoint).
func TestOrganizationEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	fx.AssertCrossTenantDenied(t, "GET", orgPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", func(o uuid.UUID) string { return orgPath(o) + "/activate" }, nil)

	// PATCH: A cannot rename B; afterwards B's name is unchanged.
	status, _ := fx.A.Do("PATCH", orgPath(fx.OrgB), map[string]any{"name": "pwned", "notes": "", "version": 1})
	if status != http.StatusNotFound {
		t.Fatalf("cross-tenant PATCH: status %d, want 404", status)
	}
	_, body := fx.B.Do("GET", orgPath(fx.OrgB), nil)
	if name := body["organization"].(map[string]any)["name"]; name != "Org B" {
		t.Fatalf("Org B renamed by another tenant: %v", name)
	}

	// Unknown and soft-deleted organizations look exactly like foreign ones.
	if status, _ := fx.A.Do("GET", orgPath(uuid.New()), nil); status != http.StatusNotFound {
		t.Fatalf("unknown org: %d", status)
	}
	if _, err := fx.Pool.Exec(context.Background(), `UPDATE organizations SET deleted_at = now() WHERE id = $1`, fx.OrgA); err != nil {
		t.Fatal(err)
	}
	if status, _ := fx.A.Do("GET", orgPath(fx.OrgA), nil); status != http.StatusNotFound {
		t.Fatalf("soft-deleted org still visible to its member: %d", status)
	}
}

func TestListMyOrganizations(t *testing.T) {
	fx := newOrgFixture(t)
	both := fx.NewUser(t, "both@example.com", false,
		tenanttest.Member{Org: fx.OrgB, Role: "viewer"}, tenanttest.Member{Org: fx.OrgA, Role: "editor"})
	status, body := both.Do("GET", "/api/orgs", nil)
	orgs := body["organizations"].([]any)
	if status != 200 || len(orgs) != 2 {
		t.Fatalf("status=%d orgs=%v", status, orgs)
	}
	first := orgs[0].(map[string]any)
	if first["name"] != "Org A" || first["role"] != "editor" {
		t.Fatalf("expected sorted by name with role: %v", orgs)
	}
	_, body = fx.A.Do("GET", "/api/orgs", nil)
	if n := len(body["organizations"].([]any)); n != 1 {
		t.Fatalf("A should see only its own org, got %d", n)
	}
}

func TestUpdateOrganizationRolesVersionAndAudit(t *testing.T) {
	fx := newOrgFixture(t)
	viewer := fx.NewUser(t, "viewer@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: "viewer"})
	editor := fx.NewUser(t, "editor@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: "editor"})

	for name, c := range map[string]*tenanttest.Client{"viewer": viewer, "editor": editor} {
		if status, _ := c.Do("PATCH", orgPath(fx.OrgA), map[string]any{"name": "X", "notes": "", "version": 1}); status != http.StatusForbidden {
			t.Errorf("%s PATCH: status %d, want 403 (checked in the backend, not just hidden in the UI)", name, status)
		}
	}
	if status, _ := fx.A.Do("PATCH", orgPath(fx.OrgA), map[string]any{"name": "   ", "notes": "", "version": 1}); status != http.StatusBadRequest {
		t.Fatalf("blank name: status %d, want 400", status)
	}

	status, body := fx.A.Do("PATCH", orgPath(fx.OrgA), map[string]any{"name": "  Công ty A  ", "notes": "HQ", "version": 1})
	org := body["organization"].(map[string]any)
	if status != 200 || org["name"] != "Công ty A" || org["version"].(float64) != 2 {
		t.Fatalf("owner PATCH: status=%d body=%v", status, body)
	}
	// Stale version (another tab saved first) → 409, data unchanged.
	if status, _ := fx.A.Do("PATCH", orgPath(fx.OrgA), map[string]any{"name": "Stale", "notes": "", "version": 1}); status != http.StatusConflict {
		t.Fatalf("stale version: status %d, want 409", status)
	}
	if n := auditCount(t, fx.Pool, "organization.update", fx.OrgA); n != 1 {
		t.Fatalf("organization.update audit rows = %d, want 1 (failed attempts must not be recorded as changes)", n)
	}
	var before, after string
	_ = fx.Pool.QueryRow(context.Background(),
		`SELECT before->>'name', after->>'name' FROM audit_log WHERE action = 'organization.update'`).Scan(&before, &after)
	if before != "Org A" || after != "Công ty A" {
		t.Fatalf("audit before/after = %q → %q", before, after)
	}
}

func TestActivateOrganizationSetsSessionDefault(t *testing.T) {
	fx := newOrgFixture(t)
	if status, _ := fx.A.Do("POST", orgPath(fx.OrgA)+"/activate", nil); status != http.StatusNoContent {
		t.Fatalf("activate: %d", status)
	}
	_, body := fx.A.Do("GET", "/api/auth/me", nil)
	if body["activeOrganizationId"] != fx.OrgA.String() {
		t.Fatalf("activeOrganizationId = %v", body["activeOrganizationId"])
	}
}

func TestAdminOrganizations(t *testing.T) {
	fx := newOrgFixture(t)
	root := fx.NewUser(t, "root@example.com", true)

	// Non-admins (even owners) cannot reach /api/admin.
	if status, _ := fx.A.Do("GET", "/api/admin/organizations", nil); status != http.StatusForbidden {
		t.Fatalf("owner on admin list: %d, want 403", status)
	}
	if status, _ := fx.A.Do("POST", "/api/admin/organizations", map[string]any{"name": "X", "kind": "customer"}); status != http.StatusForbidden {
		t.Fatalf("owner on admin create: %d, want 403", status)
	}

	// System admin is NOT a member of Org A/B → cannot read their data (ADR-023).
	if status, _ := root.Do("GET", orgPath(fx.OrgA), nil); status != http.StatusNotFound {
		t.Fatalf("system admin reading a non-member org: %d, want 404", status)
	}

	if status, _ := root.Do("POST", "/api/admin/organizations", map[string]any{"name": "Y", "kind": "bogus"}); status != http.StatusBadRequest {
		t.Fatalf("invalid kind: %d, want 400", status)
	}
	status, body := root.Do("POST", "/api/admin/organizations", map[string]any{"name": "Khách hàng C", "kind": "customer"})
	if status != http.StatusCreated || body["memberCount"].(float64) != 1 {
		t.Fatalf("create: %d %v", status, body)
	}
	orgC := uuid.MustParse(body["id"].(string))
	// Creator became owner (default addMeAsOwner=true) and can now use it.
	_, view := root.Do("GET", orgPath(orgC), nil)
	if view["membership"].(map[string]any)["role"] != "owner" {
		t.Fatalf("creator membership: %v", view)
	}
	status, body = root.Do("POST", "/api/admin/organizations", map[string]any{"name": "Không chủ", "kind": "internal", "addMeAsOwner": false})
	if status != http.StatusCreated || body["memberCount"].(float64) != 0 {
		t.Fatalf("create without owner: %d %v", status, body)
	}

	_, list := root.Do("GET", "/api/admin/organizations", nil)
	if n := len(list["organizations"].([]any)); n != 4 {
		t.Fatalf("admin list = %d orgs, want 4", n)
	}
	// Unit / site counts (counts only — the system admin is not a member of OrgA).
	mustCreate(t, fx.A, unitsPath(fx.OrgA), map[string]any{"code": "FOOD", "name": "Food"})
	mustCreate(t, fx.A, sitesPath(fx.OrgA), map[string]any{"code": "SHARED-HCM01", "name": "IDC"})
	_, list = root.Do("GET", "/api/admin/organizations", nil)
	for _, o := range list["organizations"].([]any) {
		org := o.(map[string]any)
		if org["id"] == fx.OrgA.String() && (org["unitCount"] != float64(1) || org["siteCount"] != float64(1)) {
			t.Errorf("OrgA counts = %v / %v, want 1 / 1", org["unitCount"], org["siteCount"])
		}
	}

	if status, _ := root.Do("DELETE", "/api/admin/organizations/"+orgC.String(), nil); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	if status, _ := root.Do("DELETE", "/api/admin/organizations/"+orgC.String(), nil); status != http.StatusNotFound {
		t.Fatalf("delete twice: %d, want 404", status)
	}
	if status, _ := root.Do("GET", orgPath(orgC), nil); status != http.StatusNotFound {
		t.Fatalf("deleted org still reachable: %d", status)
	}
	for _, action := range []string{"organization.create", "organization.delete"} {
		if n := auditCount(t, fx.Pool, action, orgC); n != 1 {
			t.Errorf("%s audit rows = %d, want 1", action, n)
		}
	}
}
