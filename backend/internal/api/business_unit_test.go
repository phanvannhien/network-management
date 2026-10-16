package api

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func unitsPath(org uuid.UUID) string { return orgPath(org) + "/business-units" }

// Cross-tenant isolation for every business-unit endpoint, plus using another org's unit on a site.
func TestBusinessUnitEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	unitB := idOf(t, mustCreate(t, fx.B, unitsPath(fx.OrgB), map[string]any{"code": "FOOD", "name": "B Food"}))
	unit := func(org uuid.UUID) string { return unitsPath(org) + "/" + unitB }

	fx.AssertCrossTenantDenied(t, "GET", unitsPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", unitsPath, map[string]any{"code": "AGRI", "name": "x"})
	fx.AssertCrossTenantDenied(t, "GET", unit, nil)
	fx.AssertCrossTenantDenied(t, "GET", func(o uuid.UUID) string {
		return sitesPath(o) + "/next-code?place=HN&businessUnitId=" + unitB
	}, nil)
	for _, org := range []uuid.UUID{fx.OrgB, fx.OrgA} {
		for _, r := range []struct {
			method string
			body   map[string]any
		}{
			{"PATCH", map[string]any{"code": "HACK", "name": "x", "version": 1}},
			{"DELETE", nil},
		} {
			if status, _ := fx.A.Do(r.method, unit(org), r.body); status != http.StatusNotFound {
				t.Errorf("A %s %s: %d, want 404", r.method, unit(org), status)
			}
		}
	}
	// A cannot attach a site to B's unit even with a matching code prefix.
	if status, body := fx.A.Do("POST", sitesPath(fx.OrgA), map[string]any{"code": "FOOD-HN01", "name": "x", "businessUnitId": unitB}); status != http.StatusBadRequest {
		t.Errorf("site with another org's unit: %d %v, want 400", status, body)
	}
	_, got := fx.B.Do("GET", unit(fx.OrgB), nil)
	if got["name"] != "B Food" {
		t.Errorf("B's unit changed: %v", got)
	}
}

func TestBusinessUnitRulesAndSiteCodes(t *testing.T) {
	fx := newOrgFixture(t)
	editor := fx.NewUser(t, "ed@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: "editor"})

	if status, _ := editor.Do("POST", unitsPath(fx.OrgA), map[string]any{"code": "AGRI", "name": "x"}); status != http.StatusForbidden {
		t.Errorf("editor creates a unit: %d, want 403", status)
	}
	for name, code := range map[string]string{
		"too short": "A", "starts with a digit": "1AB", "too long": "ABCDEFGHI", "symbol": "AG-RI", "reserved": "shared",
	} {
		if status, _ := fx.A.Do("POST", unitsPath(fx.OrgA), map[string]any{"code": code, "name": "x"}); status != http.StatusBadRequest {
			t.Errorf("unit code %s (%q): %d, want 400", name, code, status)
		}
	}
	agri := mustCreate(t, fx.A, unitsPath(fx.OrgA), map[string]any{"code": "agri", "name": "Mẫu Agri", "relation": "partner"})
	if agri["code"] != "AGRI" || agri["relation"] != "partner" {
		t.Errorf("unit stored as %v", agri)
	}
	agriID := idOf(t, agri)
	if status, _ := fx.A.Do("POST", unitsPath(fx.OrgA), map[string]any{"code": "AGRI", "name": "dup"}); status != http.StatusConflict {
		t.Errorf("duplicate unit code: %d, want 409", status)
	}

	// Site codes follow ADR-030: <UNIT>-<PLACE><NN>, shared sites SHARED-….
	for name, c := range map[string]struct {
		body map[string]any
		want int
	}{
		"unit site needs the unit prefix":  {map[string]any{"code": "FOOD-BD01", "name": "x", "businessUnitId": agriID}, http.StatusBadRequest},
		"shared site needs SHARED":         {map[string]any{"code": "AGRI-HC01", "name": "x"}, http.StatusBadRequest},
		"no number":                        {map[string]any{"code": "AGRI-BD", "name": "x", "businessUnitId": agriID}, http.StatusBadRequest},
		"place too long":                   {map[string]any{"code": "AGRI-BINHD01", "name": "x", "businessUnitId": agriID}, http.StatusBadRequest},
		"bad kind":                         {map[string]any{"code": "AGRI-BD01", "name": "x", "businessUnitId": agriID, "kind": "castle"}, http.StatusBadRequest},
		"factory of the unit (lower-case)": {map[string]any{"code": "agri-bd01", "name": "Nhà máy Bình Định", "businessUnitId": agriID, "kind": "factory"}, http.StatusCreated},
		"shared datacenter":                {map[string]any{"code": "SHARED-HCM01", "name": "IDC HCM", "kind": "datacenter", "isp": "FPT"}, http.StatusCreated},
	} {
		if status, body := fx.A.Do("POST", sitesPath(fx.OrgA), c.body); status != c.want {
			t.Errorf("%s: %d %v, want %d", name, status, body, c.want)
		}
	}

	// Next free code: AGRI-BD01 exists → AGRI-BD02; shared HCM → SHARED-HCM02; bad place → 400.
	next := func(q url.Values) (int, any) {
		status, body := fx.A.Do("GET", sitesPath(fx.OrgA)+"/next-code?"+q.Encode(), nil)
		return status, body["code"]
	}
	if _, code := next(url.Values{"businessUnitId": {agriID}, "place": {"bd"}}); code != "AGRI-BD02" {
		t.Errorf("next AGRI-BD = %v", code)
	}
	if _, code := next(url.Values{"place": {"HCM"}}); code != "SHARED-HCM02" {
		t.Errorf("next SHARED-HCM = %v", code)
	}
	if status, _ := next(url.Values{"place": {"H1"}}); status != http.StatusBadRequest {
		t.Errorf("bad place: %d", status)
	}

	// Filtering by unit / shared.
	_, list := fx.A.Do("GET", sitesPath(fx.OrgA)+"?businessUnitId="+agriID, nil)
	if sites := list["sites"].([]any); len(sites) != 1 || sites[0].(map[string]any)["businessUnitCode"] != "AGRI" {
		t.Errorf("unit filter: %v", list)
	}
	_, shared := fx.A.Do("GET", sitesPath(fx.OrgA)+"?shared=true", nil)
	if sites := shared["sites"].([]any); len(sites) != 1 || sites[0].(map[string]any)["kind"] != "datacenter" {
		t.Errorf("shared filter: %v", shared)
	}

	// Renaming the unit renames its site prefixes in the same transaction; deletion is blocked while it has sites.
	if status, body := fx.A.Do("PATCH", unitsPath(fx.OrgA)+"/"+agriID, map[string]any{"code": "AGR", "name": "Mẫu Agri", "relation": "partner", "version": 1}); status != http.StatusOK || body["code"] != "AGR" {
		t.Fatalf("rename unit: %d %v", status, body)
	}
	_, list = fx.A.Do("GET", sitesPath(fx.OrgA)+"?businessUnitId="+agriID, nil)
	if code := list["sites"].([]any)[0].(map[string]any)["code"]; code != "AGR-BD01" {
		t.Errorf("site code after unit rename = %v, want AGR-BD01", code)
	}
	if status, body := fx.A.Do("DELETE", unitsPath(fx.OrgA)+"/"+agriID, nil); status != http.StatusConflict {
		t.Errorf("delete unit with sites: %d %v, want 409", status, body)
	}
	empty := idOf(t, mustCreate(t, fx.A, unitsPath(fx.OrgA), map[string]any{"code": "FOOD", "name": "Mẫu Food"}))
	if status, _ := fx.A.Do("DELETE", unitsPath(fx.OrgA)+"/"+empty, nil); status != http.StatusNoContent {
		t.Errorf("delete empty unit: %d", status)
	}
	if status, _ := fx.A.Do("GET", unitsPath(fx.OrgA)+"/"+empty, nil); status != http.StatusNotFound {
		t.Errorf("deleted unit still readable: %d", status)
	}
	if n := auditCount(t, fx.Pool, "business_unit.update", fx.OrgA); n != 1 {
		t.Errorf("business_unit.update audit rows = %d", n)
	}
}
