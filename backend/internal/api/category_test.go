package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// Cross-tenant isolation for every category endpoint and the organization code preview.
func TestCategoryEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	catB := mustCategory(t, fx.B, fx.OrgB, "FOOD")
	c := func(o uuid.UUID) string { return categoriesPath(o) + "/" + catB }
	fx.AssertCrossTenantDenied(t, "GET", categoriesPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", categoriesPath, map[string]any{"code": "X1", "name": "X"})
	fx.AssertCrossTenantDenied(t, "GET", func(o uuid.UUID) string { return orgPath(o) + "/code-preview?code=NEW" }, nil)
	for _, org := range []uuid.UUID{fx.OrgB, fx.OrgA} {
		for _, r := range []struct {
			method, path string
			body         map[string]any
		}{
			{"PATCH", c(org), map[string]any{"code": "HACK", "name": "HACK", "version": 1}},
			{"POST", c(org) + "/preview", map[string]any{"code": "HACK", "name": "HACK", "version": 1}},
			{"DELETE", c(org), nil},
		} {
			if status, _ := fx.A.Do(r.method, r.path, r.body); status != http.StatusNotFound {
				t.Errorf("A %s %s: %d, want 404", r.method, r.path, status)
			}
		}
	}
	// A's category cannot sit under B's, and A's site cannot go into B's category.
	if status, _ := fx.A.Do("POST", categoriesPath(fx.OrgA), map[string]any{"code": "X1", "name": "X", "parentId": catB}); status != http.StatusBadRequest {
		t.Errorf("category under another org's category: %d, want 400", status)
	}
	if status, _ := fx.A.Do("POST", sitesPath(fx.OrgA), map[string]any{"code": "HN01", "name": "X", "categoryId": catB}); status != http.StatusBadRequest {
		t.Errorf("site in another org's category: %d, want 400", status)
	}
	_, l := fx.B.Do("GET", categoriesPath(fx.OrgB), nil)
	for _, c := range l["categories"].([]any) {
		if c := c.(map[string]any); c["id"] == catB && (c["code"] != "FOOD" || c["version"] != float64(1)) {
			t.Errorf("B's category changed: %v", c)
		}
	}
}

func TestCategoryTreeAndSiteCodes(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	// A company that manages only itself: Organization → Site, no category.
	hq := mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "hq", "name": "Trụ sở"})
	if hq["code"] != "ORG-HQ" || hq["localCode"] != "HQ" || hq["categoryId"] != nil || hq["categoryPath"] != "" {
		t.Errorf("site at the organization: %v", hq)
	}
	// Three levels: CJ Feed → Deheus → Nhà máy.
	feed := idOf(t, mustCreate(t, fx.A, categoriesPath(org), map[string]any{"code": "cjfeed", "name": "CJ Feed"}))
	deheus := idOf(t, mustCreate(t, fx.A, categoriesPath(org), map[string]any{"code": "DEHEUS", "name": "Deheus", "parentId": feed}))
	plant := idOf(t, mustCreate(t, fx.A, categoriesPath(org), map[string]any{"code": "NM", "name": "Nhà máy", "parentId": deheus}))
	bd := mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "Bình Định", "categoryId": plant})
	vp := mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM", "name": "VP Feed", "categoryId": feed})
	if bd["code"] != "ORG-CJFEED-DEHEUS-NM-BD01" || bd["categoryPath"] != "CJ Feed › Deheus › Nhà máy" || vp["code"] != "ORG-CJFEED-HCM" {
		t.Errorf("site codes: %v / %v", bd["code"], vp["code"])
	}
	for name, c := range map[string]struct {
		body map[string]any
		want int
	}{
		"bad code":         {map[string]any{"code": "1X", "name": "X"}, http.StatusBadRequest},
		"no name":          {map[string]any{"code": "XX", "name": " "}, http.StatusBadRequest},
		"unknown parent":   {map[string]any{"code": "XX", "name": "X", "parentId": uuid.NewString()}, http.StatusBadRequest},
		"sibling code":     {map[string]any{"code": "CJFEED", "name": "Khác"}, http.StatusBadRequest},
		"same code deeper": {map[string]any{"code": "CJFEED", "name": "Con", "parentId": feed}, http.StatusCreated},
	} {
		if status, body := fx.A.Do("POST", categoriesPath(org), c.body); status != c.want {
			t.Errorf("category %s: %d %v, want %d", name, status, body, c.want)
		}
	}
	// Renaming keeps codes; re-coding lists the sites first and only applies when confirmed.
	upd := map[string]any{"code": "CJFEED", "name": "CJ Feed Việt Nam", "version": 1}
	if status, body := fx.A.Do("PATCH", categoriesPath(org)+"/"+feed, upd); status != http.StatusOK || body["name"] != "CJ Feed Việt Nam" {
		t.Errorf("rename: %d %v", status, body)
	}
	recode := map[string]any{"code": "FEED", "name": "CJ Feed Việt Nam", "version": 2}
	_, preview := fx.A.Do("POST", categoriesPath(org)+"/"+feed+"/preview", recode)
	if ch := preview["changes"].([]any); len(ch) != 2 {
		t.Errorf("preview: %v", preview)
	}
	if status, _ := fx.A.Do("PATCH", categoriesPath(org)+"/"+feed, recode); status != http.StatusBadRequest {
		t.Errorf("re-code without confirmation: %d, want 400", status)
	}
	if _, s := fx.A.Do("GET", sitesPath(org)+"/"+idOf(t, bd), nil); s["code"] != "ORG-CJFEED-DEHEUS-NM-BD01" {
		t.Errorf("unconfirmed re-code changed a site: %v", s["code"])
	}
	recode["confirmSiteCodes"] = true
	if status, _ := fx.A.Do("PATCH", categoriesPath(org)+"/"+feed, recode); status != http.StatusOK {
		t.Errorf("confirmed re-code: %d", status)
	}
	if _, s := fx.A.Do("GET", sitesPath(org)+"/"+idOf(t, bd), nil); s["code"] != "ORG-FEED-DEHEUS-NM-BD01" {
		t.Errorf("site after re-code: %v", s["code"])
	}
	// Moves: no cycles; moving a branch re-codes its sites (confirmed).
	if status, _ := fx.A.Do("PATCH", categoriesPath(org)+"/"+feed, map[string]any{"code": "FEED", "name": "X", "parentId": plant, "version": 3}); status != http.StatusBadRequest {
		t.Errorf("move under its own child: %d, want 400", status)
	}
	if status, _ := fx.A.Do("PATCH", categoriesPath(org)+"/"+deheus, map[string]any{"code": "DEHEUS", "name": "Deheus", "version": 1, "confirmSiteCodes": true}); status != http.StatusOK {
		t.Errorf("move to the top: %d", status)
	}
	if _, s := fx.A.Do("GET", sitesPath(org)+"/"+idOf(t, bd), nil); s["code"] != "ORG-DEHEUS-NM-BD01" || s["categoryPath"] != "Deheus › Nhà máy" {
		t.Errorf("site after the move: %v %v", s["code"], s["categoryPath"])
	}
	// Moving a site to another category gives it the new code at once.
	// (re-coding bumped the site's version)
	_, cur := fx.A.Do("GET", sitesPath(org)+"/"+idOf(t, vp), nil)
	if status, s := fx.A.Do("PATCH", sitesPath(org)+"/"+idOf(t, vp), map[string]any{"code": "HCM", "name": "VP Feed", "categoryId": deheus, "version": cur["version"]}); status != http.StatusOK || s["code"] != "ORG-DEHEUS-HCM" {
		t.Errorf("site move: %d %v", status, s["code"])
	}
	// Clashing codes are refused (two sites HCM under DEHEUS).
	if status, _ := fx.A.Do("POST", sitesPath(org), map[string]any{"code": "HCM", "name": "Dup", "categoryId": deheus}); status != http.StatusConflict {
		t.Errorf("duplicate full code: %d, want 409", status)
	}
	// Only empty categories can be deleted.
	if status, _ := fx.A.Do("DELETE", categoriesPath(org)+"/"+plant, nil); status != http.StatusConflict {
		t.Errorf("delete a category with sites: %d, want 409", status)
	}
	empty := idOf(t, mustCreate(t, fx.A, categoriesPath(org), map[string]any{"code": "EMPTY", "name": "Trống"}))
	if status, _ := fx.A.Do("DELETE", categoriesPath(org)+"/"+empty, nil); status != http.StatusNoContent {
		t.Errorf("delete an empty category: %d", status)
	}
	// The organization code prefixes everything: preview, then confirm.
	_, op := fx.A.Do("GET", orgPath(org)+"/code-preview?code=CJ", nil)
	if n := len(op["changes"].([]any)); n != 3 {
		t.Errorf("org code preview: %d changes, want 3", n)
	}
	if status, _ := fx.A.Do("PATCH", orgPath(org), map[string]any{"code": "CJ", "name": "CJ", "notes": "", "version": 1}); status != http.StatusBadRequest {
		t.Errorf("org re-code without confirmation: %d, want 400", status)
	}
	if status, body := fx.A.Do("PATCH", orgPath(org), map[string]any{"code": "cj", "name": "CJ", "notes": "", "version": 1, "confirmSiteCodes": true}); status != http.StatusOK || body["organization"].(map[string]any)["code"] != "CJ" {
		t.Errorf("org re-code: %d %v", status, body)
	}
	if _, s := fx.A.Do("GET", sitesPath(org)+"/"+idOf(t, hq), nil); s["code"] != "CJ-HQ" {
		t.Errorf("site after org re-code: %v", s["code"])
	}
	// The category filter covers the whole branch.
	_, list := fx.A.Do("GET", sitesPath(org)+"?categoryId="+deheus, nil)
	if n := len(list["sites"].([]any)); n != 2 {
		t.Errorf("sites under Deheus: %d, want 2", n)
	}
	for _, a := range []string{"category.create", "category.update", "category.delete", "site.recode"} {
		if auditCount(t, fx.Pool, a, org) == 0 {
			t.Errorf("no %s audit", a)
		}
	}
}

func TestCategoryPermissions(t *testing.T) {
	w := newRoleWorld(t)
	org := w.fx.OrgA
	cat := mustCategory(t, w.editor, org, "FOOD")
	if _, l := w.viewer.Do("GET", categoriesPath(org), nil); len(l["categories"].([]any)) != 2 {
		t.Errorf("viewer reads the tree: %v", l)
	}
	for _, r := range []struct {
		method, path string
		body         map[string]any
	}{
		{"POST", categoriesPath(org), map[string]any{"code": "X1", "name": "X"}},
		{"PATCH", categoriesPath(org) + "/" + cat, map[string]any{"code": "X1", "name": "X", "version": 1}},
		{"POST", categoriesPath(org) + "/" + cat + "/preview", map[string]any{"code": "X1", "name": "X", "version": 1}},
		{"DELETE", categoriesPath(org) + "/" + cat, nil},
	} {
		if status, _ := w.viewer.Do(r.method, r.path, r.body); status != http.StatusForbidden {
			t.Errorf("viewer %s %s: %d, want 403", r.method, r.path, status)
		}
	}
}
