package api

import (
	"net/http"
	"testing"
)

// P2-08 (ADR-047): L3 pages are derived from IPAM — each device's interface IPs with the subnet they fall in (most
// specific, same VRF) and whether they are its gateway, endpoint groups' subnets, and subnet bars placed on a page.
// Another organization's subnet cannot be placed.
func TestDiagramL3Facts(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HQ01", "name": "HQ"}))
	fw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "FW", "type": "firewall", "siteId": site}))
	rtr := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "RTR", "type": "router", "siteId": site}))
	port := func(d, name, kind string) string {
		return idOf(t, mustCreate(t, fx.A, devicePath(org, d)+"/interfaces", map[string]any{"name": name, "kind": kind}))
	}
	ip := func(d, iface, addr string) {
		mustCreate(t, fx.A, devicePath(org, d)+"/ips", map[string]any{"interfaceId": iface, "address": addr, "role": "primary"})
	}
	lan := idOf(t, mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.1.20.0/24", "siteId": site, "gateway": "10.1.20.1"}))
	wide := idOf(t, mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.1.0.0/16", "siteId": site}))
	p2p := idOf(t, mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.0.0.0/30", "siteId": site}))
	ip(fw, port(fw, "port1", "physical"), "10.1.20.1/24")
	ip(fw, port(fw, "port9", "physical"), "10.0.0.1/30")
	ip(rtr, port(rtr, "Gi0/0", "physical"), "10.0.0.2/30")
	ip(rtr, port(rtr, "Lo0", "loopback"), "172.31.0.1/32") // in no subnet
	rng := idOf(t, mustCreate(t, fx.A, subnetsPath(org)+"/"+lan+"/ranges", map[string]any{"startIp": "10.1.20.100", "endIp": "10.1.20.150", "kind": "dhcp"}))
	pcs := idOf(t, mustCreate(t, fx.A, orgPath(org)+"/endpoint-groups", map[string]any{"kind": "pc", "name": "PCs", "siteId": site, "ipRangeId": rng}))

	dg := idOf(t, mustCreate(t, fx.A, diagramsPath(org), map[string]any{"name": "L3", "layer": "l3"})["diagram"].(map[string]any))
	v := view([]map[string]any{node("n1", "device", fw, 0), node("n2", "device", rtr, 200), node("n3", "endpoint_group", pcs, 400),
		node("s1", "subnet", wide, 0)})
	if status, res := fx.A.Do("POST", diagramsPath(org)+"/"+dg+"/save", map[string]any{"version": 1, "view": v}); status != http.StatusOK {
		t.Fatalf("save with a subnet bar: %d %v", status, res)
	}
	_, d := fx.A.Do("GET", diagramsPath(org)+"/"+dg, nil)
	l3 := d["l3"].(map[string]any)
	got := map[string]map[string]any{}
	for _, a := range l3["attachments"].([]any) {
		am := a.(map[string]any)
		got[am["address"].(string)] = am
	}
	if a := got["10.1.20.1/24"]; a == nil || a["subnetId"] != lan || a["isGateway"] != true || a["interfaceName"] != "port1" {
		t.Errorf("FW LAN IP (most specific subnet, gateway): %v", a)
	}
	if a := got["10.0.0.2/30"]; a == nil || a["subnetId"] != p2p || a["isGateway"] != false {
		t.Errorf("router /30: %v", a)
	}
	if a := got["172.31.0.1/32"]; a == nil || a["subnetId"] != nil || a["interfaceKind"] != "loopback" {
		t.Errorf("loopback in no subnet: %v", a)
	}
	if gs := l3["groups"].([]any); len(gs) != 1 || gs[0].(map[string]any)["subnetId"] != lan {
		t.Errorf("group subnet: %v", gs)
	}
	subnets := map[string]bool{}
	for _, sn := range l3["subnets"].([]any) {
		subnets[sn.(map[string]any)["id"].(string)] = true
	}
	if len(subnets) != 3 || !subnets[lan] || !subnets[p2p] || !subnets[wide] {
		t.Errorf("subnets (attached + placed): %v", l3["subnets"])
	}

	// Org B's subnet is not a node A can place.
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "B01", "name": "B"}))
	snB := idOf(t, mustCreate(t, fx.B, subnetsPath(fx.OrgB), map[string]any{"cidr": "192.168.9.0/24", "siteId": siteB}))
	v["nodes"] = append(v["nodes"].([]map[string]any), node("s2", "subnet", snB, 600))
	if status, _ := fx.A.Do("POST", diagramsPath(org)+"/"+dg+"/save", map[string]any{"version": 2, "view": v}); status != http.StatusBadRequest {
		t.Errorf("placing another organization's subnet: %d, want 400", status)
	}
}
