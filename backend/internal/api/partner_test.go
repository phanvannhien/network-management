package api

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func partnersPath(org uuid.UUID) string { return orgPath(org) + "/partners" }
func unitsPath(org uuid.UUID) string    { return orgPath(org) + "/business-units" }

// mustPartnerUnit creates partner <code> with a MAIN unit and returns both ids.
func mustPartnerUnit(t *testing.T, c *tenanttest.Client, org uuid.UUID, code string) (partnerID, unitID string) {
	t.Helper()
	partnerID = idOf(t, mustCreate(t, c, partnersPath(org), map[string]any{"code": code, "name": "Đối tác " + code}))
	unitID = idOf(t, mustCreate(t, c, unitsPath(org), map[string]any{"code": "MAIN", "name": code + " chính", "partnerId": partnerID}))
	return partnerID, unitID
}

// Cross-tenant isolation for every partner and unit endpoint, plus using another org's partner/unit.
func TestPartnerAndUnitEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	partnerB, unitB := mustPartnerUnit(t, fx.B, fx.OrgB, "FOOD")
	partner := func(org uuid.UUID) string { return partnersPath(org) + "/" + partnerB }
	unit := func(org uuid.UUID) string { return unitsPath(org) + "/" + unitB }

	fx.AssertCrossTenantDenied(t, "GET", partnersPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", partnersPath, map[string]any{"code": "AGRI", "name": "x"})
	fx.AssertCrossTenantDenied(t, "GET", partner, nil)
	fx.AssertCrossTenantDenied(t, "GET", unitsPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", unitsPath, map[string]any{"code": "MAIN", "name": "x", "partnerId": partnerB})
	fx.AssertCrossTenantDenied(t, "GET", unit, nil)
	fx.AssertCrossTenantDenied(t, "GET", func(o uuid.UUID) string {
		return sitesPath(o) + "/next-code?place=HN&partnerId=" + partnerB
	}, nil)
	for _, org := range []uuid.UUID{fx.OrgB, fx.OrgA} {
		for _, r := range []struct {
			method, path string
			body         map[string]any
		}{
			{"PATCH", partner(org), map[string]any{"code": "HACK", "name": "x", "version": 1}},
			{"DELETE", partner(org), nil},
			{"PATCH", unit(org), map[string]any{"code": "HACK", "name": "x", "version": 1}},
			{"DELETE", unit(org), nil},
		} {
			if status, _ := fx.A.Do(r.method, r.path, r.body); status != http.StatusNotFound {
				t.Errorf("A %s %s: %d, want 404", r.method, r.path, status)
			}
		}
	}
	// A cannot hang a unit under B's partner, nor a site under B's unit (even with a matching prefix).
	if status, body := fx.A.Do("POST", unitsPath(fx.OrgA), map[string]any{"code": "MAIN", "name": "x", "partnerId": partnerB}); status != http.StatusBadRequest {
		t.Errorf("unit under another org's partner: %d %v, want 400", status, body)
	}
	if status, body := fx.A.Do("POST", sitesPath(fx.OrgA), map[string]any{"code": "FOOD-HN01", "name": "x", "businessUnitId": unitB}); status != http.StatusBadRequest {
		t.Errorf("site with another org's unit: %d %v, want 400", status, body)
	}
	if _, list := fx.A.Do("GET", unitsPath(fx.OrgA)+"?partnerId="+partnerB, nil); len(list["businessUnits"].([]any)) != 0 {
		t.Errorf("A lists B's units via the partner filter: %v", list)
	}
	if _, got := fx.B.Do("GET", partner(fx.OrgB), nil); got["name"] != "Đối tác FOOD" || got["unitCount"] != float64(1) {
		t.Errorf("B's partner changed: %v", got)
	}
	if _, got := fx.B.Do("GET", unit(fx.OrgB), nil); got["code"] != "MAIN" || got["partnerCode"] != "FOOD" {
		t.Errorf("B's unit changed: %v", got)
	}
}

func TestPartnerAndUnitRules(t *testing.T) {
	fx := newOrgFixture(t)
	editor := fx.NewUser(t, "ed@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: "editor"})

	if status, _ := editor.Do("POST", partnersPath(fx.OrgA), map[string]any{"code": "AGRI", "name": "x"}); status != http.StatusForbidden {
		t.Errorf("editor creates a partner: %d, want 403", status)
	}
	for name, code := range map[string]string{
		"too short": "A", "starts with a digit": "1AB", "too long": "ABCDEFGHI", "symbol": "AG-RI", "reserved": "shared",
	} {
		if status, _ := fx.A.Do("POST", partnersPath(fx.OrgA), map[string]any{"code": code, "name": "x"}); status != http.StatusBadRequest {
			t.Errorf("partner code %s (%q): %d, want 400", name, code, status)
		}
	}
	agri := mustCreate(t, fx.A, partnersPath(fx.OrgA), map[string]any{"code": "agri", "name": "Mẫu Agri", "relation": "partner"})
	if agri["code"] != "AGRI" || agri["relation"] != "partner" {
		t.Errorf("partner stored as %v", agri)
	}
	agriID := idOf(t, agri)
	if status, _ := fx.A.Do("POST", partnersPath(fx.OrgA), map[string]any{"code": "AGRI", "name": "dup"}); status != http.StatusConflict {
		t.Errorf("duplicate partner code: %d, want 409", status)
	}
	food := idOf(t, mustCreate(t, fx.A, partnersPath(fx.OrgA), map[string]any{"code": "FOOD", "name": "Mẫu Food"}))

	// Units: code unique within the partner only; the partner must exist; editors cannot manage units.
	if status, _ := editor.Do("POST", unitsPath(fx.OrgA), map[string]any{"code": "MAIN", "name": "x", "partnerId": agriID}); status != http.StatusForbidden {
		t.Errorf("editor creates a unit: %d, want 403", status)
	}
	if status, _ := fx.A.Do("POST", unitsPath(fx.OrgA), map[string]any{"code": "MAIN", "name": "x", "partnerId": uuid.NewString()}); status != http.StatusBadRequest {
		t.Errorf("unit with an unknown partner: %d, want 400", status)
	}
	if status, _ := fx.A.Do("POST", unitsPath(fx.OrgA), map[string]any{"code": "M", "name": "x", "partnerId": agriID}); status != http.StatusBadRequest {
		t.Errorf("bad unit code: %d, want 400", status)
	}
	unit := mustCreate(t, fx.A, unitsPath(fx.OrgA), map[string]any{"code": "main", "name": "Agri chính", "partnerId": agriID})
	if unit["code"] != "MAIN" || unit["partnerCode"] != "AGRI" {
		t.Errorf("unit stored as %v", unit)
	}
	unitID := idOf(t, unit)
	if status, _ := fx.A.Do("POST", unitsPath(fx.OrgA), map[string]any{"code": "MAIN", "name": "dup", "partnerId": agriID}); status != http.StatusConflict {
		t.Errorf("duplicate unit code in a partner: %d, want 409", status)
	}
	foodMain := idOf(t, mustCreate(t, fx.A, unitsPath(fx.OrgA), map[string]any{"code": "MAIN", "name": "Food chính", "partnerId": food}))
	agriHN := idOf(t, mustCreate(t, fx.A, unitsPath(fx.OrgA), map[string]any{"code": "HN", "name": "Agri HN", "partnerId": agriID}))
	if _, list := fx.A.Do("GET", unitsPath(fx.OrgA)+"?partnerId="+agriID, nil); len(list["businessUnits"].([]any)) != 2 {
		t.Errorf("partner filter: %v", list)
	}

	// Site codes follow ADR-030/031: <PARTNER>-<PLACE><NN>, shared sites SHARED-….
	for name, c := range map[string]struct {
		body map[string]any
		want int
	}{
		"site needs the partner prefix":    {map[string]any{"code": "FOOD-BD01", "name": "x", "businessUnitId": unitID}, http.StatusBadRequest},
		"unit code is not the prefix":      {map[string]any{"code": "MAIN-BD01", "name": "x", "businessUnitId": unitID}, http.StatusBadRequest},
		"shared site needs SHARED":         {map[string]any{"code": "AGRI-HC01", "name": "x"}, http.StatusBadRequest},
		"no number":                        {map[string]any{"code": "AGRI-BD", "name": "x", "businessUnitId": unitID}, http.StatusBadRequest},
		"place too long":                   {map[string]any{"code": "AGRI-BINHD01", "name": "x", "businessUnitId": unitID}, http.StatusBadRequest},
		"bad kind":                         {map[string]any{"code": "AGRI-BD01", "name": "x", "businessUnitId": unitID, "kind": "castle"}, http.StatusBadRequest},
		"factory of the unit (lower-case)": {map[string]any{"code": "agri-bd01", "name": "Nhà máy Bình Định", "businessUnitId": unitID, "kind": "factory"}, http.StatusCreated},
		"another unit, same partner":       {map[string]any{"code": "AGRI-HN01", "name": "VP Hà Nội", "businessUnitId": agriHN}, http.StatusCreated},
		"shared datacenter":                {map[string]any{"code": "SHARED-HCM01", "name": "IDC HCM", "kind": "datacenter", "isp": "FPT"}, http.StatusCreated},
	} {
		if status, body := fx.A.Do("POST", sitesPath(fx.OrgA), c.body); status != c.want {
			t.Errorf("%s: %d %v, want %d", name, status, body, c.want)
		}
	}

	// Next free code by partner: AGRI-BD01 exists → AGRI-BD02; shared HCM → SHARED-HCM02; bad place → 400.
	next := func(q url.Values) (int, any) {
		status, body := fx.A.Do("GET", sitesPath(fx.OrgA)+"/next-code?"+q.Encode(), nil)
		return status, body["code"]
	}
	if _, code := next(url.Values{"partnerId": {agriID}, "place": {"bd"}}); code != "AGRI-BD02" {
		t.Errorf("next AGRI-BD = %v", code)
	}
	if _, code := next(url.Values{"place": {"HCM"}}); code != "SHARED-HCM02" {
		t.Errorf("next SHARED-HCM = %v", code)
	}
	if status, _ := next(url.Values{"place": {"H1"}}); status != http.StatusBadRequest {
		t.Errorf("bad place: %d", status)
	}

	// Filtering by unit / partner / shared; sites carry their partner.
	_, list := fx.A.Do("GET", sitesPath(fx.OrgA)+"?businessUnitId="+unitID, nil)
	if sites := list["sites"].([]any); len(sites) != 1 || sites[0].(map[string]any)["partnerCode"] != "AGRI" || sites[0].(map[string]any)["businessUnitCode"] != "MAIN" {
		t.Errorf("unit filter: %v", list)
	}
	if _, list := fx.A.Do("GET", sitesPath(fx.OrgA)+"?partnerId="+agriID, nil); len(list["sites"].([]any)) != 2 {
		t.Errorf("partner filter: %v", list)
	}
	_, shared := fx.A.Do("GET", sitesPath(fx.OrgA)+"?shared=true", nil)
	if sites := shared["sites"].([]any); len(sites) != 1 || sites[0].(map[string]any)["kind"] != "datacenter" || sites[0].(map[string]any)["partnerId"] != nil {
		t.Errorf("shared filter: %v", shared)
	}

	// Renaming the partner renames the prefix of every site of its units in the same transaction.
	if status, body := fx.A.Do("PATCH", partnersPath(fx.OrgA)+"/"+agriID, map[string]any{"code": "AGR", "name": "Mẫu Agri", "relation": "partner", "version": 1}); status != http.StatusOK || body["code"] != "AGR" {
		t.Fatalf("rename partner: %d %v", status, body)
	}
	_, list = fx.A.Do("GET", sitesPath(fx.OrgA)+"?partnerId="+agriID, nil)
	codes := map[any]bool{}
	for _, s := range list["sites"].([]any) {
		codes[s.(map[string]any)["code"]] = true
	}
	if !codes["AGR-BD01"] || !codes["AGR-HN01"] {
		t.Errorf("site codes after partner rename = %v, want AGR-BD01, AGR-HN01", codes)
	}
	if _, got := fx.A.Do("GET", sitesPath(fx.OrgA)+"?shared=true", nil); got["sites"].([]any)[0].(map[string]any)["code"] != "SHARED-HCM01" {
		t.Errorf("partner rename touched a shared site: %v", got)
	}
	// Renaming a unit does not touch site codes.
	if status, body := fx.A.Do("PATCH", unitsPath(fx.OrgA)+"/"+agriHN, map[string]any{"code": "NORTH", "name": "Agri miền Bắc", "version": 1}); status != http.StatusOK || body["code"] != "NORTH" {
		t.Fatalf("rename unit: %d %v", status, body)
	}
	if _, got := fx.A.Do("GET", sitesPath(fx.OrgA)+"?businessUnitId="+agriHN, nil); got["sites"].([]any)[0].(map[string]any)["code"] != "AGR-HN01" {
		t.Errorf("unit rename changed a site code: %v", got)
	}

	// Deletion is bottom-up: a unit with sites, a partner with units → 409.
	if status, body := fx.A.Do("DELETE", unitsPath(fx.OrgA)+"/"+unitID, nil); status != http.StatusConflict {
		t.Errorf("delete unit with sites: %d %v, want 409", status, body)
	}
	if status, body := fx.A.Do("DELETE", partnersPath(fx.OrgA)+"/"+food, nil); status != http.StatusConflict {
		t.Errorf("delete partner with units: %d %v, want 409", status, body)
	}
	if status, _ := editor.Do("DELETE", unitsPath(fx.OrgA)+"/"+foodMain, nil); status != http.StatusForbidden {
		t.Errorf("editor deletes a unit: %d, want 403", status)
	}
	if status, _ := fx.A.Do("DELETE", unitsPath(fx.OrgA)+"/"+foodMain, nil); status != http.StatusNoContent {
		t.Errorf("delete empty unit: %d", status)
	}
	if status, _ := fx.A.Do("GET", unitsPath(fx.OrgA)+"/"+foodMain, nil); status != http.StatusNotFound {
		t.Errorf("deleted unit still readable: %d", status)
	}
	if status, _ := fx.A.Do("DELETE", partnersPath(fx.OrgA)+"/"+food, nil); status != http.StatusNoContent {
		t.Errorf("delete empty partner: %d", status)
	}
	if status, _ := fx.A.Do("POST", unitsPath(fx.OrgA), map[string]any{"code": "MAIN", "name": "x", "partnerId": food}); status != http.StatusBadRequest {
		t.Errorf("unit under a deleted partner: %d, want 400", status)
	}
	for action, want := range map[string]int{"partner.create": 2, "partner.update": 1, "partner.delete": 1, "business_unit.create": 3, "business_unit.update": 1, "business_unit.delete": 1} {
		if n := auditCount(t, fx.Pool, action, fx.OrgA); n != want {
			t.Errorf("%s audit rows = %d, want %d", action, n, want)
		}
	}
}
