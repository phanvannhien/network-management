package api

import (
	"net/http"
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

// P1-07c (ADR-029/031): grants per partner / unit, shares, and the 404 / 403 rules for grant-only members.

type permWorld struct {
	fx                  *tenanttest.Fixture
	agri, food          string // partners
	nm, vp, foodMain    string // units: AGRI/NM, AGRI/VP, FOOD/MAIN
	bd, hn, foodHN, idc string // sites: AGRI-BD01 (NM), AGRI-HN01 (VP), FOOD-HN01, SHARED-HCM01
	pa, ue, uv, fo      *tenanttest.Client
}

func grantPath(org uuid.UUID, kind, id string) string {
	if kind == "partner" {
		return partnersPath(org) + "/" + id + "/members"
	}
	return unitsPath(org) + "/" + id + "/members"
}

func sharesPath(org uuid.UUID, site string) string { return sitesPath(org) + "/" + site + "/shares" }

// newPermWorld: OrgA with partners AGRI (units NM, VP) and FOOD (MAIN), one site each plus a shared IDC, and
// grant-only members pa (partner_admin AGRI), ue (editor NM), uv (viewer VP), fo (viewer FOOD).
func newPermWorld(t *testing.T) *permWorld {
	t.Helper()
	fx := newOrgFixture(t)
	w := &permWorld{fx: fx}
	org := fx.OrgA
	w.agri = idOf(t, mustCreate(t, fx.A, partnersPath(org), map[string]any{"code": "AGRI", "name": "Agri"}))
	w.food = idOf(t, mustCreate(t, fx.A, partnersPath(org), map[string]any{"code": "FOOD", "name": "Food"}))
	unit := func(p, code string) string {
		return idOf(t, mustCreate(t, fx.A, unitsPath(org), map[string]any{"code": code, "name": code, "partnerId": p}))
	}
	w.nm, w.vp, w.foodMain = unit(w.agri, "NM"), unit(w.agri, "VP"), unit(w.food, "MAIN")
	site := func(code, unit string) string {
		body := map[string]any{"code": code, "name": code}
		if unit != "" {
			body["businessUnitId"] = unit
		}
		return idOf(t, mustCreate(t, fx.A, sitesPath(org), body))
	}
	w.bd, w.hn, w.foodHN, w.idc = site("AGRI-BD01", w.nm), site("AGRI-HN01", w.vp), site("FOOD-HN01", w.foodMain), site("SHARED-HCM01", "")
	member := func(email, kind, id, role string) *tenanttest.Client {
		c := fx.NewUser(t, email, false, tenanttest.Member{Org: org, Role: "member"})
		mustCreate(t, fx.A, grantPath(org, kind, id), map[string]any{"email": email, "role": role})
		return c
	}
	w.pa = member("pa@example.com", "partner", w.agri, "partner_admin")
	w.ue = member("ue@example.com", "unit", w.nm, "editor")
	w.uv = member("uv@example.com", "unit", w.vp, "viewer")
	w.fo = member("fo@example.com", "partner", w.food, "viewer")
	return w
}

func codesOf(t *testing.T, body map[string]any, key string) []string {
	t.Helper()
	out := []string{}
	for _, v := range body[key].([]any) {
		out = append(out, v.(map[string]any)["code"].(string))
	}
	slices.Sort(out)
	return out
}

func TestGrantOnlyMembersSeeTheirPartnersAndUnits(t *testing.T) {
	w := newPermWorld(t)
	org := w.fx.OrgA
	for name, c := range map[string]struct {
		client                 *tenanttest.Client
		partners, units, sites []string
	}{
		"partner_admin AGRI": {w.pa, []string{"AGRI"}, []string{"NM", "VP"}, []string{"AGRI-BD01", "AGRI-HN01"}},
		"editor of NM":       {w.ue, []string{"AGRI"}, []string{"NM"}, []string{"AGRI-BD01"}},
		"viewer of FOOD":     {w.fo, []string{"FOOD"}, []string{"MAIN"}, []string{"FOOD-HN01"}},
		"owner":              {w.fx.A, []string{"AGRI", "FOOD"}, []string{"MAIN", "NM", "VP"}, []string{"AGRI-BD01", "AGRI-HN01", "FOOD-HN01", "SHARED-HCM01"}},
	} {
		_, p := c.client.Do("GET", partnersPath(org), nil)
		_, u := c.client.Do("GET", unitsPath(org), nil)
		_, s := c.client.Do("GET", sitesPath(org), nil)
		if got := codesOf(t, p, "partners"); !slices.Equal(got, c.partners) {
			t.Errorf("%s partners = %v, want %v", name, got, c.partners)
		}
		if got := codesOf(t, u, "businessUnits"); !slices.Equal(got, c.units) {
			t.Errorf("%s units = %v, want %v", name, got, c.units)
		}
		if got := codesOf(t, s, "sites"); !slices.Equal(got, c.sites) {
			t.Errorf("%s sites = %v, want %v", name, got, c.sites)
		}
	}
	// Everything outside the grants answers 404, like another organization's data.
	for _, path := range []string{
		sitesPath(org) + "/" + w.foodHN, sitesPath(org) + "/" + w.hn, sitesPath(org) + "/" + w.idc,
		sitesPath(org) + "/" + w.foodHN + "/locations", sitesPath(org) + "/" + w.hn + "/racks",
		unitsPath(org) + "/" + w.vp, partnersPath(org) + "/" + w.food,
		sitesPath(org) + "/next-code?place=HN&partnerId=" + w.food,
	} {
		if status, _ := w.ue.Do("GET", path, nil); status != http.StatusNotFound {
			t.Errorf("editor of NM GET %s: %d, want 404", path, status)
		}
	}
	if status, _ := w.ue.Do("PATCH", sitesPath(org)+"/"+w.foodHN, map[string]any{"code": "FOOD-HN01", "name": "x", "version": 1}); status != http.StatusNotFound {
		t.Errorf("editor of NM patches FOOD's site: %d, want 404", status)
	}
	if status, _ := w.ue.Do("GET", orgPath(org)+"/members", nil); status != http.StatusForbidden {
		t.Errorf("grant-only member lists organization members: %d, want 403", status)
	}
	// The membership view carries the grants (UI only — the server checks every request).
	_, view := w.pa.Do("GET", orgPath(org), nil)
	ms := view["membership"].(map[string]any)
	if ms["role"] != "member" || len(ms["partnerGrants"].([]any)) != 1 || len(ms["unitGrants"].([]any)) != 0 {
		t.Errorf("membership of partner_admin: %v", ms)
	}
	// Access levels shown to the UI.
	_, bd := w.ue.Do("GET", sitesPath(org)+"/"+w.bd, nil)
	_, agri := w.ue.Do("GET", partnersPath(org)+"/"+w.agri, nil)
	_, nm := w.pa.Do("GET", unitsPath(org)+"/"+w.nm, nil)
	if bd["access"] != "edit" || agri["access"] != "view" || nm["access"] != "admin" {
		t.Errorf("access: site %v, partner %v, unit %v", bd["access"], agri["access"], nm["access"])
	}
}

func TestGrantOnlyMembersWriteWithinTheirScope(t *testing.T) {
	w := newPermWorld(t)
	org := w.fx.OrgA
	site := func(c *tenanttest.Client, method, path string, body map[string]any, want int, what string) map[string]any {
		t.Helper()
		status, got := c.Do(method, path, body)
		if status != want {
			t.Errorf("%s: %d %v, want %d", what, status, got, want)
		}
		return got
	}
	// Unit editor: sites and locations of the unit only; no unit/partner management, no deleting.
	bd2 := site(w.ue, "POST", sitesPath(org), map[string]any{"code": "AGRI-BD02", "name": "BD2", "businessUnitId": w.nm}, http.StatusCreated, "editor of NM adds a site")
	site(w.ue, "POST", sitesPath(org), map[string]any{"code": "AGRI-HN02", "name": "x", "businessUnitId": w.vp}, http.StatusBadRequest, "editor of NM adds a site to VP")
	site(w.ue, "POST", sitesPath(org), map[string]any{"code": "SHARED-DN01", "name": "x"}, http.StatusForbidden, "editor of NM adds a shared site")
	site(w.ue, "PATCH", sitesPath(org)+"/"+w.bd, map[string]any{"code": "AGRI-BD01", "name": "Nhà máy BD", "businessUnitId": w.nm, "version": 1}, http.StatusOK, "editor of NM edits its site")
	site(w.ue, "PATCH", sitesPath(org)+"/"+w.bd, map[string]any{"code": "AGRI-BD01", "name": "x", "businessUnitId": w.vp, "version": 2}, http.StatusBadRequest, "editor of NM moves a site to VP")
	site(w.ue, "POST", sitesPath(org)+"/"+w.bd+"/locations", map[string]any{"kind": "building", "name": "Tòa A"}, http.StatusCreated, "editor of NM adds a location")
	site(w.ue, "DELETE", sitesPath(org)+"/"+w.bd, nil, http.StatusForbidden, "editor of NM deletes a site")
	site(w.ue, "PATCH", unitsPath(org)+"/"+w.nm, map[string]any{"code": "NM", "name": "x", "version": 1}, http.StatusForbidden, "editor of NM edits the unit")
	site(w.ue, "POST", unitsPath(org), map[string]any{"code": "X1", "name": "x", "partnerId": w.agri}, http.StatusForbidden, "editor of NM adds a unit")
	site(w.uv, "PATCH", sitesPath(org)+"/"+w.hn, map[string]any{"code": "AGRI-HN01", "name": "x", "businessUnitId": w.vp, "version": 1}, http.StatusForbidden, "viewer of VP edits a site")
	site(w.uv, "POST", sitesPath(org)+"/"+w.hn+"/racks", map[string]any{"name": "R1", "uHeight": 42}, http.StatusForbidden, "viewer of VP adds a rack")

	// Partner admin: units and sites of AGRI, the partner itself; not FOOD, not deleting the partner.
	site(w.pa, "POST", unitsPath(org), map[string]any{"code": "KHO", "name": "Kho", "partnerId": w.agri}, http.StatusCreated, "partner_admin adds a unit")
	site(w.pa, "POST", unitsPath(org), map[string]any{"code": "KHO", "name": "Kho", "partnerId": w.food}, http.StatusBadRequest, "partner_admin adds a unit to FOOD")
	site(w.pa, "PATCH", partnersPath(org)+"/"+w.agri, map[string]any{"code": "AGRI", "name": "Agri VN", "version": 1}, http.StatusOK, "partner_admin edits the partner")
	site(w.pa, "DELETE", partnersPath(org)+"/"+w.agri, nil, http.StatusForbidden, "partner_admin deletes the partner")
	site(w.pa, "PATCH", sitesPath(org)+"/"+idOf(t, bd2), map[string]any{"code": "AGRI-BD02", "name": "BD2", "businessUnitId": w.vp, "version": 1}, http.StatusOK, "partner_admin moves a site between AGRI units")
	site(w.pa, "DELETE", sitesPath(org)+"/"+idOf(t, bd2), nil, http.StatusNoContent, "partner_admin deletes a site")
	site(w.pa, "POST", partnersPath(org), map[string]any{"code": "NEWP", "name": "x"}, http.StatusForbidden, "partner_admin creates a partner")

	// An organization editor keeps organization-wide editing but manages no users.
	ed := w.fx.NewUser(t, "orged@example.com", false, tenanttest.Member{Org: org, Role: "editor"})
	site(ed, "POST", sitesPath(org), map[string]any{"code": "FOOD-DN01", "name": "x", "businessUnitId": w.foodMain}, http.StatusCreated, "organization editor adds a FOOD site")
	site(ed, "GET", grantPath(org, "partner", w.agri), nil, http.StatusForbidden, "organization editor lists partner grants")
}

func TestGrantManagement(t *testing.T) {
	w := newPermWorld(t)
	org := w.fx.OrgA
	// partner_admin invites a new email to a unit of its partner: invite link + membership with role member.
	status, body := w.pa.Do("POST", grantPath(org, "unit", w.nm), map[string]any{"email": "new@example.com", "role": "unit_admin"})
	if status != http.StatusCreated || body["inviteToken"] == nil || body["member"].(map[string]any)["role"] != "unit_admin" {
		t.Fatalf("invite to a unit: %d %v", status, body)
	}
	var role string
	if err := w.fx.Pool.QueryRow(t.Context(), `SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'new@example.com' AND m.organization_id = $1`, org).Scan(&role); err != nil || role != "member" {
		t.Errorf("invited membership role = %q (%v)", role, err)
	}
	if status, _ := w.pa.Do("POST", grantPath(org, "unit", w.nm), map[string]any{"email": "new@example.com", "role": "viewer"}); status != http.StatusConflict {
		t.Errorf("duplicate grant: %d, want 409", status)
	}
	// Existing organization members keep their organization role.
	if status, _ := w.pa.Do("POST", grantPath(org, "partner", w.agri), map[string]any{"email": "ue@example.com", "role": "viewer"}); status != http.StatusCreated {
		t.Errorf("grant an existing member on the partner: %d", status)
	}
	for name, c := range map[string]struct {
		client *tenanttest.Client
		path   string
		want   int
	}{
		"editor of NM lists NM grants":        {w.ue, grantPath(org, "unit", w.nm), http.StatusForbidden},
		"viewer of FOOD lists AGRI grants":    {w.fo, grantPath(org, "partner", w.agri), http.StatusNotFound},
		"partner_admin lists FOOD grants":     {w.pa, grantPath(org, "partner", w.food), http.StatusNotFound},
		"partner_admin lists its unit grants": {w.pa, grantPath(org, "unit", w.vp), http.StatusOK},
	} {
		if status, _ := c.client.Do("GET", c.path, nil); status != c.want {
			t.Errorf("%s: %d, want %d", name, status, c.want)
		}
	}
	// unit_admin manages its unit, not its siblings or the partner.
	if status, _ := w.pa.Do("PATCH", grantPath(org, "unit", w.vp)+"/"+w.uv.UserID.String(), map[string]any{"role": "unit_admin", "version": 1}); status != http.StatusOK {
		t.Fatalf("promote to unit_admin: %d", status)
	}
	if status, _ := w.pa.Do("PATCH", grantPath(org, "unit", w.vp)+"/"+w.uv.UserID.String(), map[string]any{"role": "viewer", "version": 1}); status != http.StatusConflict {
		t.Errorf("stale grant update: %d, want 409", status)
	}
	if status, _ := w.uv.Do("POST", grantPath(org, "unit", w.vp), map[string]any{"email": "vp2@example.com", "role": "editor"}); status != http.StatusCreated {
		t.Errorf("unit_admin invites to its unit: %d", status)
	}
	if status, _ := w.uv.Do("POST", grantPath(org, "unit", w.nm), map[string]any{"email": "x@example.com", "role": "editor"}); status != http.StatusNotFound {
		t.Errorf("unit_admin of VP invites to NM: %d, want 404", status)
	}
	if status, _ := w.uv.Do("POST", grantPath(org, "partner", w.agri), map[string]any{"email": "x@example.com", "role": "editor"}); status != http.StatusForbidden {
		t.Errorf("unit_admin invites to the partner: %d, want 403", status)
	}
	if status, _ := w.pa.Do("POST", grantPath(org, "unit", w.nm), map[string]any{"email": "x@example.com", "role": "partner_admin"}); status != http.StatusBadRequest {
		t.Errorf("partner role on a unit: %d, want 400", status)
	}
	// Revoking a grant removes the access at once.
	if status, _ := w.pa.Do("DELETE", grantPath(org, "unit", w.nm)+"/"+w.ue.UserID.String(), nil); status != http.StatusNoContent {
		t.Fatalf("revoke: %d", status)
	}
	if status, _ := w.pa.Do("DELETE", grantPath(org, "partner", w.agri)+"/"+w.ue.UserID.String(), nil); status != http.StatusNoContent {
		t.Fatalf("revoke partner grant: %d", status)
	}
	if status, _ := w.ue.Do("GET", sitesPath(org)+"/"+w.bd, nil); status != http.StatusNotFound {
		t.Errorf("revoked editor still reads the site: %d", status)
	}
	// Leaving the organization drops every grant.
	if status, _ := w.fx.A.Do("DELETE", memberPath(org, w.fo.UserID), nil); status != http.StatusNoContent {
		t.Fatalf("remove member: %d", status)
	}
	var n int
	if err := w.fx.Pool.QueryRow(t.Context(), `SELECT count(*) FROM partner_members WHERE user_id = $1`, w.fo.UserID).Scan(&n); err != nil || n != 0 {
		t.Errorf("grants left after leaving: %d (%v)", n, err)
	}
	for action, want := range map[string]int{"grant.add": 7, "grant.update": 1, "grant.remove": 2} {
		if got := auditCount(t, w.fx.Pool, action, org); got != want {
			t.Errorf("%s audit rows = %d, want %d", action, got, want)
		}
	}
}

func TestSiteShares(t *testing.T) {
	w := newPermWorld(t)
	org := w.fx.OrgA
	idcPatch := func(c *tenanttest.Client, version int) int {
		status, _ := c.Do("PATCH", sitesPath(org)+"/"+w.idc, map[string]any{"code": "SHARED-HCM01", "name": "IDC", "version": version})
		return status
	}
	// Share the IDC read-only to AGRI: every unit of AGRI sees it, nobody there may edit it; FOOD does not see it.
	share := mustCreate(t, w.fx.A, sharesPath(org, w.idc), map[string]any{"targetType": "partner", "targetId": w.agri, "access": "view"})
	if share["targetCode"] != "AGRI" {
		t.Errorf("share = %v", share)
	}
	for name, c := range map[string]*tenanttest.Client{"pa": w.pa, "ue": w.ue, "uv": w.uv} {
		if status, body := c.Do("GET", sitesPath(org)+"/"+w.idc, nil); status != http.StatusOK || body["access"] != "view" {
			t.Errorf("%s reads the shared IDC: %d %v", name, status, body["access"])
		}
	}
	if status, _ := w.fo.Do("GET", sitesPath(org)+"/"+w.idc, nil); status != http.StatusNotFound {
		t.Errorf("FOOD reads the IDC shared to AGRI: %d, want 404", status)
	}
	if status := idcPatch(w.ue, 1); status != http.StatusForbidden {
		t.Errorf("edit through a view share: %d, want 403", status)
	}
	// Editable share: editors at the target edit, viewers still read; shares never allow deleting or re-sharing.
	if status, _ := w.fx.A.Do("PATCH", sharesPath(org, w.idc)+"/"+idOf(t, share), map[string]any{"access": "edit", "version": 1}); status != http.StatusOK {
		t.Fatalf("make share editable: %d", status)
	}
	if status := idcPatch(w.ue, 1); status != http.StatusOK {
		t.Errorf("editor of NM edits through an edit share: %d", status)
	}
	// Editing through a share does not allow taking the site over (moving it into one's own unit).
	if status, _ := w.ue.Do("PATCH", sitesPath(org)+"/"+w.idc, map[string]any{"code": "AGRI-HCM01", "name": "IDC", "businessUnitId": w.nm, "version": 2}); status != http.StatusForbidden {
		t.Errorf("share editor moves the shared site into its unit: %d, want 403", status)
	}
	if status := idcPatch(w.uv, 2); status != http.StatusForbidden {
		t.Errorf("viewer of VP edits through an edit share: %d, want 403", status)
	}
	if status, _ := w.ue.Do("DELETE", sitesPath(org)+"/"+w.idc, nil); status != http.StatusForbidden {
		t.Errorf("delete through a share: %d, want 403", status)
	}
	if status, _ := w.pa.Do("GET", sharesPath(org, w.idc), nil); status != http.StatusForbidden {
		t.Errorf("partner_admin lists shares of a site it only receives: %d, want 403", status)
	}
	// A partner_admin shares its own site to a unit of another partner.
	if status, _ := w.pa.Do("POST", sharesPath(org, w.bd), map[string]any{"targetType": "business_unit", "targetId": w.foodMain, "access": "edit"}); status != http.StatusCreated {
		t.Fatalf("partner_admin shares its site: %d", status)
	}
	if status, body := w.fo.Do("GET", sitesPath(org)+"/"+w.bd, nil); status != http.StatusOK || body["access"] != "view" {
		t.Errorf("FOOD viewer reads the shared site: %d %v (viewer stays view on an edit share)", status, body["access"])
	}
	for name, c := range map[string]struct {
		client *tenanttest.Client
		body   map[string]any
		want   int
	}{
		"to its own partner":       {w.pa, map[string]any{"targetType": "partner", "targetId": w.agri, "access": "view"}, http.StatusBadRequest},
		"to another org's partner": {w.pa, map[string]any{"targetType": "partner", "targetId": uuid.NewString(), "access": "view"}, http.StatusBadRequest},
		"duplicate":                {w.pa, map[string]any{"targetType": "business_unit", "targetId": w.foodMain, "access": "view"}, http.StatusConflict},
		"by a unit editor":         {w.ue, map[string]any{"targetType": "partner", "targetId": w.food, "access": "view"}, http.StatusForbidden},
		"bad access":               {w.pa, map[string]any{"targetType": "partner", "targetId": w.food, "access": "admin"}, http.StatusBadRequest},
	} {
		if status, _ := c.client.Do("POST", sharesPath(org, w.bd), c.body); status != c.want {
			t.Errorf("share %s: %d, want %d", name, status, c.want)
		}
	}
	// Revoking the share hides the site again.
	if status, _ := w.fx.A.Do("DELETE", sharesPath(org, w.idc)+"/"+idOf(t, share), nil); status != http.StatusNoContent {
		t.Fatalf("revoke share: %d", status)
	}
	if status, _ := w.ue.Do("GET", sitesPath(org)+"/"+w.idc, nil); status != http.StatusNotFound {
		t.Errorf("site still visible after revoking the share: %d", status)
	}
	for action, want := range map[string]int{"share.create": 2, "share.update": 1, "share.delete": 1} {
		if got := auditCount(t, w.fx.Pool, action, org); got != want {
			t.Errorf("%s audit rows = %d, want %d", action, got, want)
		}
	}
}

// Cross-tenant isolation for every grant and share endpoint.
func TestGrantAndShareEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	partnerB, unitB := mustPartnerUnit(t, fx.B, fx.OrgB, "FOOD")
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "FOOD-HN01", "name": "B", "businessUnitId": unitB}))
	shareB := idOf(t, mustCreate(t, fx.B, sharesPath(fx.OrgB, siteB), map[string]any{"targetType": "partner", "targetId": idOf(t, mustCreate(t, fx.B, partnersPath(fx.OrgB), map[string]any{"code": "AGRI", "name": "x"})), "access": "view"}))
	mustCreate(t, fx.B, grantPath(fx.OrgB, "partner", partnerB), map[string]any{"email": "bmember@example.com", "role": "viewer"})

	for _, c := range []struct {
		method string
		path   func(uuid.UUID) string
		body   any
	}{
		{"GET", func(o uuid.UUID) string { return grantPath(o, "partner", partnerB) }, nil},
		{"POST", func(o uuid.UUID) string { return grantPath(o, "partner", partnerB) }, map[string]any{"email": "x@example.com", "role": "viewer"}},
		{"GET", func(o uuid.UUID) string { return grantPath(o, "unit", unitB) }, nil},
		{"POST", func(o uuid.UUID) string { return grantPath(o, "unit", unitB) }, map[string]any{"email": "x@example.com", "role": "viewer"}},
		{"GET", func(o uuid.UUID) string { return sharesPath(o, siteB) }, nil},
		{"POST", func(o uuid.UUID) string { return sharesPath(o, siteB) }, map[string]any{"targetType": "partner", "targetId": partnerB, "access": "view"}},
	} {
		fx.AssertCrossTenantDenied(t, c.method, c.path, c.body)
	}
	var bUser string
	if err := fx.Pool.QueryRow(t.Context(), `SELECT id::text FROM users WHERE email = 'bmember@example.com'`).Scan(&bUser); err != nil {
		t.Fatal(err)
	}
	for _, org := range []uuid.UUID{fx.OrgB, fx.OrgA} {
		for _, r := range []struct {
			method, path string
			body         map[string]any
		}{
			{"PATCH", grantPath(org, "partner", partnerB) + "/" + bUser, map[string]any{"role": "partner_admin", "version": 1}},
			{"DELETE", grantPath(org, "partner", partnerB) + "/" + bUser, nil},
			{"PATCH", sharesPath(org, siteB) + "/" + shareB, map[string]any{"access": "edit", "version": 1}},
			{"DELETE", sharesPath(org, siteB) + "/" + shareB, nil},
		} {
			if status, _ := fx.A.Do(r.method, r.path, r.body); status != http.StatusNotFound {
				t.Errorf("A %s %s: %d, want 404", r.method, r.path, status)
			}
		}
	}
	// A's own site cannot be shared to B's partner.
	siteA := idOf(t, mustCreate(t, fx.A, sitesPath(fx.OrgA), map[string]any{"code": "SHARED-HN01", "name": "A"}))
	if status, _ := fx.A.Do("POST", sharesPath(fx.OrgA, siteA), map[string]any{"targetType": "partner", "targetId": partnerB, "access": "view"}); status != http.StatusBadRequest {
		t.Errorf("share to another org's partner: %d, want 400", status)
	}
	// B's own control request added x@example.com; the bmember grant must still be a viewer.
	_, got := fx.B.Do("GET", grantPath(fx.OrgB, "partner", partnerB), nil)
	for _, g := range got["members"].([]any) {
		if g := g.(map[string]any); g["email"] == "bmember@example.com" && (g["role"] != "viewer" || g["version"] != float64(1)) {
			t.Errorf("B's grant changed: %v", g)
		}
	}
	if _, got := fx.B.Do("GET", sharesPath(fx.OrgB, siteB), nil); got["shares"].([]any)[0].(map[string]any)["access"] != "view" {
		t.Errorf("B's share changed: %v", got)
	}
}
