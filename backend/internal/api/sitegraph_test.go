package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// P2-21: the site graph is derived from the inventory — each site's card (gateway, WAN lines, counts, detail
// diagrams) and one edge per pair of sites with links between them — only in the caller's organization.
func TestSiteGraph(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	cat := mustCategory(t, fx.A, org, "MAU")
	path := func(o uuid.UUID) string { return orgPath(o) + "/site-graph" }
	fx.AssertCrossTenantDenied(t, "GET", path, nil)
	// A head office with HA and two branches (VPN to the head office), from a design template.
	if status, res := fx.A.Do("POST", designPath(org, "apply"), map[string]any{"scenario": "branches", "vendor": "fortinet_cisco",
		"users": 60, "branches": 2, "branchUsers": 20, "ha": true, "categoryId": cat}); status != http.StatusCreated {
		t.Fatalf("design: %d %v", status, res)
	}
	// B's sites never show in A's graph.
	catB := mustCategory(t, fx.B, fx.OrgB, "MAU")
	mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "X01", "name": "B", "categoryId": catB})

	status, g := fx.A.Do("GET", path(org), nil)
	if status != http.StatusOK {
		t.Fatalf("graph: %d %v", status, g)
	}
	sites := g["sites"].([]any)
	if len(sites) != 3 {
		t.Fatalf("sites: %v", sites)
	}
	byName := map[string]map[string]any{}
	for _, s := range sites {
		byName[s.(map[string]any)["name"].(string)] = s.(map[string]any)
	}
	hq := byName["Trụ sở"]
	// Two ISP lines (each seen by both members of the HA pair: one entry ×2), named after the template's providers.
	wan := hq["wan"].([]any)
	if hq["gateway"] != "FortiGate 100F ×2 HA" || hq["peers"] != 2.0 || len(wan) != 2 || len(hq["diagrams"].([]any)) != 1 ||
		wan[0].(map[string]any)["provider"] != "Nhà mạng 1" || wan[0].(map[string]any)["service"] != "internet_broadband" {
		t.Errorf("head office card: %v", hq)
	}
	if hq["planned"] != hq["devices"] {
		t.Errorf("all planned: %v", hq)
	}
	edges := g["edges"].([]any)
	if len(edges) != 2 {
		t.Fatalf("edges (one per branch, each VPN link once): %v", edges)
	}
	for _, e := range edges {
		e := e.(map[string]any)
		if e["style"] != "vpn" || e["links"] != 1.0 || e["service"] != "vpn" || e["medium"] != "VPN/IPsec" || e["more"] != 0.0 {
			t.Errorf("edge: %v", e)
		}
	}
	// A category narrows it; an unknown category or another org's is not found.
	other := mustCategory(t, fx.A, org, "KHAC")
	mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "K01", "name": "Khác", "categoryId": other})
	if _, g := fx.A.Do("GET", path(org)+"?categoryId="+other, nil); len(g["sites"].([]any)) != 1 || len(g["edges"].([]any)) != 0 {
		t.Errorf("category filter: %v", g)
	}
	for _, c := range []string{uuid.NewString(), catB} {
		if status, _ := fx.A.Do("GET", path(org)+"?categoryId="+c, nil); status != http.StatusNotFound {
			t.Errorf("category %s: %d", c, status)
		}
	}
}
