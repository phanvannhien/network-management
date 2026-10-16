package api

import (
	"testing"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

// roleWorld (ADR-032): OrgA with two sites and an editor and a viewer besides the owner. Access is decided by the
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
	_, nm := mustPartnerUnit(t, fx.A, org, "AGRI")
	w := &roleWorld{fx: fx}
	w.site = idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "AGRI-BD01", "name": "BD", "businessUnitId": nm}))
	w.other = idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "AGRI-HN01", "name": "HN", "businessUnitId": nm}))
	w.editor = fx.NewUser(t, "editor@example.com", false, tenanttest.Member{Org: org, Role: "editor"})
	w.viewer = fx.NewUser(t, "viewer@example.com", false, tenanttest.Member{Org: org, Role: "viewer"})
	return w
}
