package api

import (
	"context"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func auditPath(org uuid.UUID) string { return orgPath(org) + "/audit" }

// insertAudit writes a row directly (the table is append-only; tests only insert).
func insertAudit(t *testing.T, pool *pgxpool.Pool, org *uuid.UUID, actor uuid.UUID, action, objectID string, at time.Time) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO audit_log (organization_id, actor_user_id, action, object_type, object_id, before, after, created_at)
		 VALUES ($1, $2, $3, 'test', $4, '{"name":"old"}', '{"name":"new"}', $5)`,
		org, actor, action, objectID, at); err != nil {
		t.Fatalf("insert audit: %v", err)
	}
}

func entries(t *testing.T, body map[string]any) []map[string]any {
	t.Helper()
	raw, ok := body["entries"].([]any)
	if !ok {
		t.Fatalf("no entries in %v", body)
	}
	out := make([]map[string]any, len(raw))
	for i, e := range raw {
		out[i] = e.(map[string]any)
	}
	return out
}

// Cross-tenant isolation (mandatory per endpoint) and no leaking of B's rows through A's org.
func TestOrgAuditIsTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	now := time.Now()
	insertAudit(t, fx.Pool, &fx.OrgB, fx.B.UserID, "organization.update", "secret-b", now)
	insertAudit(t, fx.Pool, &fx.OrgA, fx.A.UserID, "organization.update", "row-a", now)
	fx.AssertCrossTenantDenied(t, "GET", auditPath, nil)

	status, body := fx.A.Do("GET", auditPath(fx.OrgA), nil)
	if status != http.StatusOK {
		t.Fatalf("A reads own audit: %d %v", status, body)
	}
	for _, e := range entries(t, body) {
		if e["objectId"] == "secret-b" {
			t.Fatal("org B row returned in org A audit")
		}
	}
	if body["total"] != float64(1) {
		t.Errorf("total = %v, want 1", body["total"])
	}
}

func TestOrgAuditRequiresOwnerOrAdmin(t *testing.T) {
	fx := newOrgFixture(t)
	for _, role := range []string{"editor", "viewer"} {
		c := fx.NewUser(t, role+"@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: role})
		if status, _ := c.Do("GET", auditPath(fx.OrgA), nil); status != http.StatusForbidden {
			t.Errorf("%s: status %d, want 403", role, status)
		}
	}
	admin := fx.NewUser(t, "admin@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: "admin"})
	if status, _ := admin.Do("GET", auditPath(fx.OrgA), nil); status != http.StatusOK {
		t.Errorf("admin: status %d, want 200", status)
	}
}

func TestOrgAuditFiltersAndPaging(t *testing.T) {
	fx := newOrgFixture(t)
	other := fx.NewUser(t, "ed@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: "editor"})
	base := time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)
	for i := range 5 {
		insertAudit(t, fx.Pool, &fx.OrgA, fx.A.UserID, "member.update", "m-"+string(rune('a'+i)), base.Add(time.Duration(i)*time.Hour))
	}
	insertAudit(t, fx.Pool, &fx.OrgA, other.UserID, "organization.update", "100%_literal", base.Add(10*time.Hour))

	get := func(q url.Values) map[string]any {
		t.Helper()
		status, body := fx.A.Do("GET", auditPath(fx.OrgA)+"?"+q.Encode(), nil)
		if status != http.StatusOK {
			t.Fatalf("GET ?%s: %d %v", q.Encode(), status, body)
		}
		return body
	}

	// Newest first, paged with the full total.
	body := get(url.Values{"pageSize": {"2"}, "page": {"1"}})
	es := entries(t, body)
	if body["total"] != float64(6) || len(es) != 2 || es[0]["action"] != "organization.update" {
		t.Fatalf("page 1: total=%v entries=%v", body["total"], es)
	}
	if es[0]["before"].(map[string]any)["name"] != "old" || es[0]["actor"].(map[string]any)["email"] != "ed@example.com" {
		t.Errorf("entry details: %v", es[0])
	}
	if es := entries(t, get(url.Values{"pageSize": {"2"}, "page": {"3"}})); len(es) != 2 || es[1]["objectId"] != "m-a" {
		t.Errorf("page 3: %v", es)
	}

	cases := []struct {
		name string
		q    url.Values
		want float64
	}{
		{"category", url.Values{"category": {"member"}}, 5},
		{"two categories", url.Values{"category": {"member", "organization"}}, 6},
		{"actor", url.Values{"actorId": {other.UserID.String()}}, 1},
		{"time window", url.Values{"from": {base.Add(time.Hour).Format(time.RFC3339)}, "to": {base.Add(3 * time.Hour).Format(time.RFC3339)}}, 2},
		{"text in object id", url.Values{"q": {"M-C"}}, 1},
		{"text in actor email", url.Values{"q": {"ed@"}}, 1},
		{"like wildcards are literal", url.Values{"q": {"%_"}}, 1},
		{"underscore alone matches nothing extra", url.Values{"q": {"_x"}}, 0},
	}
	for _, c := range cases {
		if got := get(c.q)["total"]; got != c.want {
			t.Errorf("%s: total=%v, want %v", c.name, got, c.want)
		}
	}

	for _, bad := range []url.Values{
		{"pageSize": {"500"}},
		{"page": {"0"}},
		{"category": {"DROP TABLE"}},
		{"from": {base.Format(time.RFC3339)}, "to": {base.Format(time.RFC3339)}},
	} {
		if status, _ := fx.A.Do("GET", auditPath(fx.OrgA)+"?"+bad.Encode(), nil); status != http.StatusBadRequest {
			t.Errorf("?%s: status %d, want 400", bad.Encode(), status)
		}
	}
}

func TestSystemAuditOnlyForSystemAdminsAndOnlySystemRows(t *testing.T) {
	fx := newOrgFixture(t)
	sys := fx.NewUser(t, "root@example.com", true)
	now := time.Now()
	insertAudit(t, fx.Pool, nil, sys.UserID, "auth.login", "root@example.com", now)
	insertAudit(t, fx.Pool, &fx.OrgA, fx.A.UserID, "organization.update", "org-row", now)

	if status, _ := fx.A.Do("GET", "/api/admin/audit", nil); status != http.StatusForbidden {
		t.Errorf("org owner: status %d, want 403", status)
	}
	status, body := sys.Do("GET", "/api/admin/audit", nil)
	if status != http.StatusOK {
		t.Fatalf("system admin: %d %v", status, body)
	}
	for _, e := range entries(t, body) {
		if e["objectId"] == "org-row" {
			t.Fatal("organization row leaked into the system audit (ADR-023)")
		}
	}
	if body["total"] != float64(1) {
		t.Errorf("total = %v, want 1", body["total"])
	}
	// Membership is still required to read an organization's own log (ADR-023).
	if status, _ := sys.Do("GET", auditPath(fx.OrgA), nil); status != http.StatusNotFound {
		t.Errorf("system admin without membership on org audit: %d, want 404", status)
	}
}

func TestUserAdministrationAuditHasBeforeAfter(t *testing.T) {
	fx := newOrgFixture(t)
	sys := fx.NewUser(t, "root@example.com", true)
	if status, body := sys.Do("POST", "/api/admin/users/"+fx.B.UserID.String()+"/disable", nil); status != http.StatusNoContent {
		t.Fatalf("disable: %d %v", status, body)
	}
	_, body := sys.Do("GET", "/api/admin/audit?category=user", nil)
	es := entries(t, body)
	if len(es) != 1 || es[0]["action"] != "user.disable" {
		t.Fatalf("entries = %v", es)
	}
	if es[0]["before"].(map[string]any)["disabled"] != false || es[0]["after"].(map[string]any)["disabled"] != true {
		t.Errorf("before/after = %v / %v", es[0]["before"], es[0]["after"])
	}
	if es[0]["ip"] == "" || es[0]["actor"].(map[string]any)["email"] != "root@example.com" {
		t.Errorf("meta = %v", es[0])
	}
}
