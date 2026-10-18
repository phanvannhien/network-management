package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func segmentsPath(org uuid.UUID) string { return orgPath(org) + "/segments" }

// P2-08 (ADR-047): segments — shared networks cables end in (no port); editors write, audited, tenant-scoped; one
// cables still end in cannot go; drawn on diagrams and grouping sites on the overview.
func TestSegments(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	fx.AssertCrossTenantDenied(t, "GET", segmentsPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", segmentsPath, map[string]any{"name": "MPLS", "kind": "mpls_l3vpn"})

	isp := idOf(t, mustCreate(t, fx.A, vendorsPath(org), map[string]any{"kind": "isp", "name": "Viettel"}))
	seg := mustCreate(t, fx.A, segmentsPath(org), map[string]any{"name": "MPLS Viettel", "kind": "mpls_l3vpn", "vendorId": isp,
		"serviceId": "VPN-0042"})
	sid := seg["id"].(string)
	if seg["vendorName"] != "Viettel" || seg["linkCount"] != float64(0) {
		t.Errorf("created: %v", seg)
	}
	if status, _ := fx.A.Do("POST", segmentsPath(org), map[string]any{"name": "mpls viettel", "kind": "metro_l2"}); status != http.StatusConflict {
		t.Errorf("duplicate name: %d", status)
	}
	for _, bad := range []map[string]any{{"name": "", "kind": "mpls_l3vpn"}, {"name": "X", "kind": "bus"}, {"name": "Y", "kind": "other", "vendorId": uuid.NewString()}} {
		if status, _ := fx.A.Do("POST", segmentsPath(org), bad); status != http.StatusBadRequest {
			t.Errorf("%v: %d", bad, status)
		}
	}
	viewer := fx.NewUser(t, "viewer-seg@example.com", false, tenanttest.Member{Org: org, Role: "viewer"})
	if status, _ := viewer.Do("POST", segmentsPath(org), map[string]any{"name": "Z", "kind": "other"}); status != http.StatusForbidden {
		t.Errorf("viewer creating: %d", status)
	}
	for _, p := range []string{segmentsPath(fx.OrgB) + "/" + sid, segmentsPath(org) + "/" + sid} {
		if status, _ := fx.B.Do("GET", p, nil); status != http.StatusNotFound {
			t.Errorf("org B reading %s: %d", p, status)
		}
	}
	if status, _ := fx.B.Do("DELETE", segmentsPath(fx.OrgB)+"/"+sid, nil); status != http.StatusNotFound {
		t.Errorf("org B deleting A's segment: %d", status)
	}

	// Two sites' routers join the MPLS; ports only at the device end, WAN-ish cables only.
	siteHQ := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HQ01", "name": "HQ"}))
	siteBR := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BR01", "name": "Branch"}))
	rtr := func(h, site string) (string, string) {
		d := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": h, "type": "router", "siteId": site}))
		p := idOf(t, mustCreate(t, fx.A, devicePath(org, d)+"/interfaces", map[string]any{"name": "Gi0/0", "kind": "physical", "media": "RJ45"}))
		return d, p
	}
	hq, hqP := rtr("HQ-RTR", siteHQ)
	br, brP := rtr("BR-RTR", siteBR)
	segEnd := map[string]any{"kind": "segment", "id": sid}
	if status, body := fx.A.Do("POST", linksPath(org), map[string]any{"a": devEnd(hq, hqP), "b": map[string]any{"kind": "segment", "id": sid, "interfaceId": hqP}, "kind": "ethernet"}); status != http.StatusBadRequest {
		t.Errorf("port on the segment end: %d %v", status, body)
	}
	if status, _ := fx.A.Do("POST", linksPath(org), map[string]any{"a": devEnd(hq, ""), "b": segEnd, "kind": "console"}); status != http.StatusBadRequest {
		t.Errorf("console cable into a segment: %d", status)
	}
	if status, body := fx.A.Do("POST", linksPath(org), map[string]any{"a": devEnd(hq, hqP), "b": segEnd, "kind": "ethernet", "service": "mpls"}); status != http.StatusCreated {
		t.Fatalf("router into the MPLS: %d %v", status, body)
	}
	link := mustCreate(t, fx.A, linksPath(org), map[string]any{"a": segEnd, "b": devEnd(br, brP), "kind": "ethernet"})
	if a := link["a"].(map[string]any); a["kind"] != "segment" || a["name"] != "MPLS Viettel" || a["siteId"] != nil {
		t.Errorf("segment end: %v", a)
	}
	segB := idOf(t, mustCreate(t, fx.B, segmentsPath(fx.OrgB), map[string]any{"name": "B net", "kind": "other"}))
	if status, _ := fx.A.Do("POST", linksPath(org), map[string]any{"a": devEnd(hq, ""), "b": map[string]any{"kind": "segment", "id": segB}, "kind": "logical"}); status != http.StatusBadRequest {
		t.Errorf("cable into another organization's segment: %d", status)
	}

	// Deleting while cables end in it: refused.
	if status, _ := fx.A.Do("DELETE", segmentsPath(org)+"/"+sid, nil); status != http.StatusConflict {
		t.Errorf("delete with cables: %d", status)
	}
	if _, got := fx.A.Do("GET", segmentsPath(org)+"/"+sid, nil); got["linkCount"] != float64(2) {
		t.Errorf("link count: %v", got)
	}

	// On a diagram: the segment node and its cables to the routers.
	dg := idOf(t, mustCreate(t, fx.A, diagramsPath(org), map[string]any{"name": "WAN", "layer": "physical"})["diagram"].(map[string]any))
	v := view([]map[string]any{node("n1", "device", hq, 0), node("n2", "device", br, 400), node("s1", "segment", sid, 200)})
	if status, res := fx.A.Do("POST", diagramsPath(org)+"/"+dg+"/save", map[string]any{"version": 1, "view": v}); status != http.StatusOK {
		t.Fatalf("save: %d %v", status, res)
	}
	_, d := fx.A.Do("GET", diagramsPath(org)+"/"+dg, nil)
	if len(d["links"].([]any)) != 2 || len(d["segments"].([]any)) != 1 {
		t.Errorf("diagram: links %v segments %v", d["links"], d["segments"])
	}
	v["nodes"] = append(v["nodes"].([]map[string]any), node("s2", "segment", segB, 600))
	if status, _ := fx.A.Do("POST", diagramsPath(org)+"/"+dg+"/save", map[string]any{"version": 2, "view": v}); status != http.StatusBadRequest {
		t.Errorf("placing another organization's segment: %d", status)
	}

	// Overview: one MPLS with both sites, not an HQ–branch edge.
	_, g := fx.A.Do("GET", orgPath(org)+"/site-graph", nil)
	segs := g["segments"].([]any)
	if len(segs) != 1 || len(segs[0].(map[string]any)["sites"].([]any)) != 2 {
		t.Errorf("site graph segments: %v", segs)
	}

	seg["notes"] = "SLA 99.9%"
	seg["version"] = float64(1)
	if status, got := fx.A.Do("PATCH", segmentsPath(org)+"/"+sid, seg); status != http.StatusOK || got["version"] != float64(2) {
		t.Errorf("edit: %d %v", status, got)
	}
	for _, a := range []string{"segment.create", "segment.update"} {
		if auditCount(t, fx.Pool, a, org) == 0 {
			t.Errorf("%s not audited", a)
		}
	}
}
