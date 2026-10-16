package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func sitesPath(org uuid.UUID) string { return orgPath(org) + "/sites" }

func mustCreate(t *testing.T, c *tenanttest.Client, path string, body map[string]any) map[string]any {
	t.Helper()
	status, resp := c.Do("POST", path, body)
	if status != http.StatusCreated {
		t.Fatalf("POST %s: %d %v", path, status, resp)
	}
	return resp
}

func idOf(t *testing.T, v map[string]any) string {
	t.Helper()
	id, _ := v["id"].(string)
	if id == "" {
		t.Fatalf("no id in %v", v)
	}
	return id
}

// Cross-tenant isolation for every site / location / rack endpoint (mandatory per CLAUDE.md).
func TestSiteEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "HN01", "name": "B HQ"}))
	locB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB)+"/"+siteB+"/locations", map[string]any{"kind": "room", "name": "Server room"}))
	rackB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB)+"/"+siteB+"/racks", map[string]any{"locationId": locB, "name": "R1"}))

	site := func(org uuid.UUID) string { return sitesPath(org) + "/" + siteB }
	fx.AssertCrossTenantDenied(t, "GET", sitesPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", sitesPath, map[string]any{"code": "XX01", "name": "x"})
	fx.AssertCrossTenantDenied(t, "GET", site, nil)
	fx.AssertCrossTenantDenied(t, "GET", func(o uuid.UUID) string { return site(o) + "/locations" }, nil)
	fx.AssertCrossTenantDenied(t, "GET", func(o uuid.UUID) string { return site(o) + "/racks" }, nil)

	// Writes through B's org path as A → 404, and A's own org path cannot reach B's rows either.
	for _, org := range []uuid.UUID{fx.OrgB, fx.OrgA} {
		for _, r := range []struct {
			method, path string
			body         map[string]any
		}{
			{"PATCH", site(org), map[string]any{"code": "HN01", "name": "hacked", "version": 1}},
			{"DELETE", site(org), nil},
			{"POST", site(org) + "/locations", map[string]any{"kind": "building", "name": "A"}},
			{"PATCH", site(org) + "/locations/" + locB, map[string]any{"name": "hacked", "version": 1}},
			{"DELETE", site(org) + "/locations/" + locB, nil},
			{"POST", site(org) + "/racks", map[string]any{"locationId": locB, "name": "R2"}},
			{"PATCH", site(org) + "/racks/" + rackB, map[string]any{"locationId": locB, "name": "hacked", "version": 1}},
			{"DELETE", site(org) + "/racks/" + rackB, nil},
		} {
			if status, _ := fx.A.Do(r.method, r.path, r.body); status != http.StatusNotFound {
				t.Errorf("A %s %s: %d, want 404", r.method, r.path, status)
			}
		}
	}
	_, got := fx.B.Do("GET", site(fx.OrgB), nil)
	if got["name"] != "B HQ" || got["rackCount"] != float64(1) || got["locationCount"] != float64(1) {
		t.Errorf("B's site changed or counts wrong: %v", got)
	}
}

func TestSiteRolesValidationAndSoftDelete(t *testing.T) {
	fx := newOrgFixture(t)
	editor := fx.NewUser(t, "ed@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: "editor"})
	viewer := fx.NewUser(t, "view@example.com", false, tenanttest.Member{Org: fx.OrgA, Role: "viewer"})

	if status, _ := viewer.Do("POST", sitesPath(fx.OrgA), map[string]any{"code": "VV01", "name": "v"}); status != http.StatusForbidden {
		t.Errorf("viewer create: %d, want 403", status)
	}
	created := mustCreate(t, editor, sitesPath(fx.OrgA), map[string]any{
		"code": "HN01", "name": "HQ Hà Nội", "contactEmail": "it@example.com",
	})
	if created["timezone"] != "Asia/Ho_Chi_Minh" {
		t.Errorf("default timezone: %v", created["timezone"])
	}
	id := idOf(t, created)
	for name, body := range map[string]map[string]any{
		"duplicate code (case-insensitive)": {"code": "hn01", "name": "dup"},
		"bad timezone":                      {"code": "DN01", "name": "x", "timezone": "Mars/Base"},
		"bad email":                         {"code": "DN01", "name": "x", "contactEmail": "not-an-email"},
		"space in code":                     {"code": "SHARED DN01", "name": "x"},
	} {
		status, _ := editor.Do("POST", sitesPath(fx.OrgA), body)
		want := http.StatusBadRequest
		if name == "duplicate code (case-insensitive)" {
			want = http.StatusConflict
		}
		if status != want {
			t.Errorf("%s: %d, want %d", name, status, want)
		}
	}
	if status, _ := viewer.Do("GET", sitesPath(fx.OrgA)+"/"+id, nil); status != http.StatusOK {
		t.Errorf("viewer read: %d", status)
	}
	if status, _ := viewer.Do("PATCH", sitesPath(fx.OrgA)+"/"+id, map[string]any{"code": "HN01", "name": "x", "version": 1}); status != http.StatusForbidden {
		t.Errorf("viewer update: %d, want 403", status)
	}
	if status, _ := editor.Do("PATCH", sitesPath(fx.OrgA)+"/"+id, map[string]any{"code": "HN01", "name": "HQ mới", "version": 99}); status != http.StatusConflict {
		t.Errorf("stale version: %d, want 409", status)
	}
	if status, body := editor.Do("PATCH", sitesPath(fx.OrgA)+"/"+id, map[string]any{"code": "HN01", "name": "HQ mới", "version": 1}); status != http.StatusOK || body["version"] != float64(2) {
		t.Errorf("update: %d %v", status, body)
	}
	if n := auditCount(t, fx.Pool, "site.update", fx.OrgA); n != 1 {
		t.Errorf("site.update audit rows = %d", n)
	}

	// Delete: owner/admin only; soft — the row stays, the code becomes free again.
	if status, _ := editor.Do("DELETE", sitesPath(fx.OrgA)+"/"+id, nil); status != http.StatusForbidden {
		t.Errorf("editor delete: %d, want 403", status)
	}
	if status, _ := fx.A.Do("DELETE", sitesPath(fx.OrgA)+"/"+id, nil); status != http.StatusNoContent {
		t.Fatalf("owner delete: %d", status)
	}
	if status, _ := fx.A.Do("GET", sitesPath(fx.OrgA)+"/"+id, nil); status != http.StatusNotFound {
		t.Errorf("deleted site still readable: %d", status)
	}
	var kept int
	if err := fx.Pool.QueryRow(t.Context(), `SELECT count(*) FROM sites WHERE id = $1 AND deleted_at IS NOT NULL`, id).Scan(&kept); err != nil || kept != 1 {
		t.Errorf("soft delete row: %d %v", kept, err)
	}
	mustCreate(t, editor, sitesPath(fx.OrgA), map[string]any{"code": "HN01", "name": "HQ again"})
}

func TestLocationTreeAndRacks(t *testing.T) {
	fx := newOrgFixture(t)
	site := sitesPath(fx.OrgA) + "/" + idOf(t, mustCreate(t, fx.A, sitesPath(fx.OrgA), map[string]any{"code": "HN01", "name": "HQ"}))
	other := sitesPath(fx.OrgA) + "/" + idOf(t, mustCreate(t, fx.A, sitesPath(fx.OrgA), map[string]any{"code": "DN01", "name": "DN"}))
	locs := site + "/locations"

	building := idOf(t, mustCreate(t, fx.A, locs, map[string]any{"kind": "building", "name": "Tòa A"}))
	floor := idOf(t, mustCreate(t, fx.A, locs, map[string]any{"kind": "floor", "name": "Tầng 3", "parentId": building}))
	room := idOf(t, mustCreate(t, fx.A, locs, map[string]any{"kind": "room", "name": "Phòng máy chủ", "parentId": floor}))
	mustCreate(t, fx.A, locs, map[string]any{"kind": "room", "name": "Tủ tầng trệt"}) // small site: room under the site
	otherBuilding := idOf(t, mustCreate(t, fx.A, other+"/locations", map[string]any{"kind": "building", "name": "Khác"}))

	for name, c := range map[string]struct {
		body map[string]any
		want int
	}{
		"building under a floor":      {map[string]any{"kind": "building", "name": "B", "parentId": floor}, http.StatusBadRequest},
		"floor under a room":          {map[string]any{"kind": "floor", "name": "F", "parentId": room}, http.StatusBadRequest},
		"parent from another site":    {map[string]any{"kind": "floor", "name": "F", "parentId": otherBuilding}, http.StatusBadRequest},
		"duplicate sibling name":      {map[string]any{"kind": "floor", "name": "tầng 3", "parentId": building}, http.StatusConflict},
		"same name elsewhere is fine": {map[string]any{"kind": "floor", "name": "Tầng 3"}, http.StatusCreated},
	} {
		if status, body := fx.A.Do("POST", locs, c.body); status != c.want {
			t.Errorf("%s: %d %v, want %d", name, status, body, c.want)
		}
	}

	racks := site + "/racks"
	rack := mustCreate(t, fx.A, racks, map[string]any{"locationId": room, "name": "Rack A1"})
	if rack["uHeight"] != float64(42) {
		t.Errorf("default U: %v", rack["uHeight"])
	}
	if status, _ := fx.A.Do("POST", racks, map[string]any{"locationId": otherBuilding, "name": "X"}); status != http.StatusBadRequest {
		t.Errorf("rack in another site's location: %d, want 400", status)
	}
	if status, _ := fx.A.Do("POST", racks, map[string]any{"locationId": room, "name": "Big", "uHeight": 61}); status != http.StatusBadRequest {
		t.Errorf("61U: %d, want 400", status)
	}

	// Deleting a node that still has children or racks is refused with a clear 409.
	if status, body := fx.A.Do("DELETE", locs+"/"+floor, nil); status != http.StatusConflict {
		t.Errorf("delete floor with a room: %d %v", status, body)
	}
	if status, _ := fx.A.Do("DELETE", locs+"/"+room, nil); status != http.StatusConflict {
		t.Errorf("delete room with a rack: %d", status)
	}
	if status, _ := fx.A.Do("DELETE", racks+"/"+idOf(t, rack), nil); status != http.StatusNoContent {
		t.Errorf("delete empty rack: %d", status)
	}
	if status, _ := fx.A.Do("DELETE", locs+"/"+room, nil); status != http.StatusNoContent {
		t.Errorf("delete empty room: %d", status)
	}
	_, list := fx.A.Do("GET", locs, nil)
	if n := len(list["locations"].([]any)); n != 4 {
		t.Errorf("locations left = %d, want 4", n)
	}
	if n := auditCount(t, fx.Pool, "location.create", fx.OrgA); n != 6 {
		t.Errorf("location.create audit rows = %d, want 6", n)
	}
}

// ADR-025: a scoped editor/viewer only sees and edits its sites; owner/admin are never scoped.
