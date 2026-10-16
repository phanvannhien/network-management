package api

import (
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

// roleWorld (ADR-032): OrgA with two sites (category AGRI) and an editor and a viewer besides the owner. Access is decided by the
// organization role only, so every member sees every site.
type roleWorld struct {
	fx             *tenanttest.Fixture
	site, other    string
	editor, viewer *tenanttest.Client
}

func newRoleWorld(t *testing.T) *roleWorld {
	t.Helper()
	fx := newOrgFixture(t)
	org := fx.OrgA
	nm := mustCategory(t, fx.A, org, "AGRI")
	w := &roleWorld{fx: fx}
	w.site = idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "BD", "categoryId": nm}))
	w.other = idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HN01", "name": "HN", "categoryId": nm}))
	w.editor = fx.NewUser(t, "editor@example.com", false, tenanttest.Member{Org: org, Role: "editor"})
	w.viewer = fx.NewUser(t, "viewer@example.com", false, tenanttest.Member{Org: org, Role: "viewer"})
	return w
}

// mustCategory creates a top-level category (name = code) and returns its id.
func mustCategory(t *testing.T, c *tenanttest.Client, org uuid.UUID, code string) string {
	t.Helper()
	return idOf(t, mustCreate(t, c, categoriesPath(org), map[string]any{"code": code, "name": code}))
}

func categoriesPath(org uuid.UUID) string { return orgPath(org) + "/categories" }
