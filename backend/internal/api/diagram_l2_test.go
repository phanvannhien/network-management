package api

import (
	"net/http"
	"testing"
)

// P2-08 (ADR-047): the diagram detail carries what the L2 view draws — each cable end's switchport facts (mode,
// VLANs, LAG), the VLANs of the sites on the view plus the organization-wide ones (not another site's or another
// organization's), and the devices routing a VLAN (holding its subnet's gateway).
func TestDiagramL2Facts(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))
	other := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HN01", "name": "HN"}))
	vlan20 := idOf(t, mustCreate(t, fx.A, vlansPath(org), map[string]any{"vid": 20, "name": "Camera", "siteId": site, "color": "#16a34a"}))
	mustCreate(t, fx.A, vlansPath(org), map[string]any{"vid": 99, "name": "MGMT"})
	mustCreate(t, fx.A, vlansPath(org), map[string]any{"vid": 30, "name": "Voice HN", "siteId": other})
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "B01", "name": "B"}))
	mustCreate(t, fx.B, vlansPath(fx.OrgB), map[string]any{"vid": 40, "name": "B only", "siteId": siteB})

	core := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "CORE", "type": "l3_switch", "siteId": site}))
	acc := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "ACC", "type": "poe_switch", "siteId": site}))
	port := func(dev string, body map[string]any) string {
		return idOf(t, mustCreate(t, fx.A, devicePath(org, dev)+"/interfaces", body))
	}
	po := port(core, map[string]any{"name": "Po1", "kind": "lag", "mode": "trunk", "nativeVlan": 99, "allowedVlans": "20,99"})
	coreP := port(core, map[string]any{"name": "Te1/1/1", "kind": "physical", "media": "SFP+", "mode": "trunk", "nativeVlan": 99,
		"allowedVlans": "20,99", "lagId": po})
	accP := port(acc, map[string]any{"name": "Te1/1/1", "kind": "physical", "media": "SFP+", "mode": "trunk", "allowedVlans": "20,99"})
	svi := port(core, map[string]any{"name": "Vlan20", "kind": "svi"})
	mustCreate(t, fx.A, devicePath(org, core)+"/ips", map[string]any{"interfaceId": svi, "address": "10.1.20.1/24", "role": "primary"})
	mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.1.20.0/24", "siteId": site, "vlanId": vlan20, "gateway": "10.1.20.1"})
	link := idOf(t, mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(core, coreP), "b": devEnd(acc, accP), "kind": "fiber"}))
	// A second member with nothing set on itself follows its LAG (Cisco style: settings on the port-channel).
	coreP2 := port(core, map[string]any{"name": "Te1/1/2", "kind": "physical", "media": "SFP+", "lagId": po})
	accP2 := port(acc, map[string]any{"name": "Te1/1/2", "kind": "physical", "media": "SFP+", "mode": "trunk", "allowedVlans": "20,99"})
	link2 := idOf(t, mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(core, coreP2), "b": devEnd(acc, accP2), "kind": "fiber"}))

	dg := idOf(t, mustCreate(t, fx.A, diagramsPath(org), map[string]any{"name": "L2", "layer": "physical"})["diagram"].(map[string]any))
	v := view([]map[string]any{node("n1", "device", core, 0), node("n2", "device", acc, 200)})
	if status, res := fx.A.Do("POST", diagramsPath(org)+"/"+dg+"/save", map[string]any{"version": 1, "view": v}); status != http.StatusOK {
		t.Fatalf("save: %d %v", status, res)
	}
	status, d := fx.A.Do("GET", diagramsPath(org)+"/"+dg, nil)
	if status != http.StatusOK {
		t.Fatalf("detail: %d %v", status, d)
	}
	byID := map[string]map[string]any{}
	for _, l := range d["links"].([]any) {
		byID[l.(map[string]any)["id"].(string)] = l.(map[string]any)
	}
	if len(byID) != 2 || byID[link] == nil || byID[link2] == nil {
		t.Fatalf("links: %v", d["links"])
	}
	if m := byID[link2]["a"].(map[string]any); m["interfaceMode"] != "trunk" || m["nativeVlan"] != float64(99) || m["allowedVlans"] != "20,99" {
		t.Errorf("member without settings should follow its LAG: %v", m)
	}
	a, b := byID[link]["a"].(map[string]any), byID[link]["b"].(map[string]any)
	if a["interfaceMode"] != "trunk" || a["nativeVlan"] != float64(99) || a["allowedVlans"] != "20,99" || a["lagId"] != po || a["lagName"] != "Po1" {
		t.Errorf("core end: %v", a)
	}
	if b["interfaceMode"] != "trunk" || b["nativeVlan"] != nil || b["accessVlan"] != nil || b["lagId"] != nil || b["lagName"] != "" {
		t.Errorf("access switch end: %v", b)
	}
	got := map[float64]string{}
	for _, x := range d["vlans"].([]any) {
		vv := x.(map[string]any)
		got[vv["vid"].(float64)] = vv["name"].(string)
	}
	if len(got) != 2 || got[20] != "Camera" || got[99] != "MGMT" {
		t.Errorf("vlans (want this site's 20 and the organization's 99, not HN's 30 or org B's 40): %v", got)
	}
	gws := d["gateways"].([]any)
	if len(gws) != 1 {
		t.Fatalf("gateways: %v", gws)
	}
	if g := gws[0].(map[string]any); g["deviceId"] != core || g["vid"] != float64(20) || g["address"] != "10.1.20.1" || g["interfaceName"] != "Vlan20" {
		t.Errorf("gateway: %v", g)
	}
	// Org B cannot read the diagram (and so its VLAN facts) through its own organization.
	if status, _ := fx.B.Do("GET", diagramsPath(fx.OrgB)+"/"+dg, nil); status != http.StatusNotFound {
		t.Errorf("B reading A's diagram: %d", status)
	}
}
