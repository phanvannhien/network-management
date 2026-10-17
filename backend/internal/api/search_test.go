package api

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/google/uuid"
)

func searchPath(org uuid.UUID, q string) string {
	return orgPath(org) + "/search?q=" + url.QueryEscape(q)
}

// P1-23: one box finds devices (hostname, S/N, part number), addresses (exact or the prefix being typed), MACs in any
// notation and endpoint groups — only in the caller's organization — with the diagrams placing each hit.
func TestGlobalSearch(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	unit := mustCategory(t, fx.A, org, "FOOD")
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM", "categoryId": unit}))
	sw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "HCM-CORE-01", "type": "l3_switch", "siteId": site,
		"serialNumber": "FOC2233X0AB", "partNumber": "C9300-48P-E"}))
	vlan := idOf(t, mustCreate(t, fx.A, devicePath(org, sw)+"/interfaces", map[string]any{"name": "Vlan10", "kind": "svi", "mac": "aa:bb:cc:dd:ee:01"}))
	mustCreate(t, fx.A, devicePath(org, sw)+"/ips", map[string]any{"interfaceId": vlan, "address": "10.136.10.1/24", "role": "primary"})
	mustCreate(t, fx.A, devicePath(org, sw)+"/ips", map[string]any{"interfaceId": vlan, "address": "2001:db8:10::1/64", "role": "secondary"})
	ha := idOf(t, mustCreate(t, fx.A, clustersPath(org), map[string]any{"kind": "ha_active_passive", "name": "FW-HA-HCM", "siteId": site}))
	fw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "FW-HCM-01", "type": "firewall", "siteId": site, "clusterId": ha, "clusterMemberNo": 1}))
	grp := idOf(t, mustCreate(t, fx.A, groupsPath(org), map[string]any{"siteId": site, "kind": "ip_camera", "name": "Camera tầng 1"}))
	dg := idOf(t, mustCreate(t, fx.A, diagramsPath(org), map[string]any{"name": "LAN HCM", "layer": "physical"})["diagram"].(map[string]any))
	if status, body := fx.A.Do("POST", diagramsPath(org)+"/"+dg+"/save", map[string]any{"version": 1,
		"view": view([]map[string]any{node("n1", "device", sw, 0), node("n2", "endpoint_group", grp, 200), node("n3", "device", fw, 400)})}); status != http.StatusOK {
		t.Fatalf("save diagram: %d %v", status, body)
	}
	// B has a look-alike device: never in A's results, and A's search path is closed to B.
	unitB := mustCategory(t, fx.B, fx.OrgB, "FOOD")
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "HCM01", "name": "B", "categoryId": unitB}))
	mustCreate(t, fx.B, devicesPath(fx.OrgB), map[string]any{"hostname": "HCM-CORE-99", "type": "l3_switch", "siteId": siteB})
	fx.AssertCrossTenantDenied(t, "GET", func(o uuid.UUID) string { return searchPath(o, "HCM") }, nil)

	get := func(q string) map[string]any {
		t.Helper()
		status, body := fx.A.Do("GET", searchPath(org, q), nil)
		if status != http.StatusOK {
			t.Fatalf("search %q: %d %v", q, status, body)
		}
		return body
	}
	hits := func(body map[string]any, group string) []map[string]any {
		var out []map[string]any
		for _, h := range body[group].([]any) {
			out = append(out, h.(map[string]any))
		}
		return out
	}

	devs := hits(get("hcm-core"), "devices")
	if len(devs) != 1 || devs[0]["id"] != sw || devs[0]["matched"] != "hostname" {
		t.Fatalf("by hostname (other org must not show): %v", devs)
	}
	if d := devs[0]["diagrams"].([]any); len(d) != 1 || d[0].(map[string]any)["id"] != dg {
		t.Errorf("diagrams placing the device: %v", d)
	}
	if devs := hits(get("2233x0"), "devices"); len(devs) != 1 || devs[0]["matched"] != "serial" || devs[0]["matchedValue"] != "FOC2233X0AB" {
		t.Errorf("by serial: %v", devs)
	}
	if devs := hits(get("C9300-48"), "devices"); len(devs) != 1 || devs[0]["matched"] != "partNumber" {
		t.Errorf("by part number: %v", devs)
	}
	for _, q := range []string{"10.136.", "10.136.10.1", "10.136.10.1/24"} {
		if ips := hits(get(q), "ips"); len(ips) != 1 || ips[0]["deviceId"] != sw || ips[0]["interfaceName"] != "Vlan10" || len(ips[0]["diagrams"].([]any)) != 1 {
			t.Errorf("by address %q: %v", q, ips)
		}
	}
	if ips := hits(get("10.136.10.12"), "ips"); len(ips) != 0 {
		t.Errorf("a longer address must not match: %v", ips)
	}
	if ips := hits(get("10.136.10.0/24"), "ips"); len(ips) != 1 || ips[0]["host"] != "10.136.10.1" {
		t.Errorf("addresses in a subnet: %v", ips)
	}
	if ips := hits(get("10.136.10.10"), "ips"); len(ips) != 0 {
		t.Errorf("an exact address must not match the ones it prefixes: %v", ips)
	}
	for _, q := range []string{"2001:DB8:10::1", "2001:0db8:0010:0000::1", "2001:db8:10:"} {
		if ips := hits(get(q), "ips"); len(ips) != 1 || ips[0]["deviceId"] != sw {
			t.Errorf("IPv6 %q: %v", q, ips)
		}
	}
	if macs := hits(get("10.136.10.1"), "macs"); len(macs) != 0 {
		t.Errorf("an address looked up as a MAC: %v", macs)
	}
	if c := hits(get("fw-ha"), "clusters"); len(c) != 1 || c[0]["id"] != ha || c[0]["kind"] != "ha_active_passive" || len(c[0]["diagrams"].([]any)) != 1 {
		t.Errorf("cluster by name, on the diagram through its member: %v", c)
	}
	for _, q := range []string{"AABB.CCDD.EE01", "aa-bb-cc", "bb:cc:dd"} {
		if macs := hits(get(q), "macs"); len(macs) != 1 || macs[0]["deviceId"] != sw {
			t.Errorf("by MAC %q: %v", q, macs)
		}
	}
	if g := hits(get("camera"), "groups"); len(g) != 1 || g[0]["id"] != grp || len(g[0]["diagrams"].([]any)) != 1 {
		t.Errorf("endpoint group: %v", g)
	}
	// LIKE wildcards are literal text.
	if devs := hits(get("%_"), "devices"); len(devs) != 0 {
		t.Errorf("wildcards matched: %v", devs)
	}
	if status, _ := fx.A.Do("GET", searchPath(org, "x"), nil); status != http.StatusBadRequest {
		t.Errorf("one-letter search: %d", status)
	}
}
