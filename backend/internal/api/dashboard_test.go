package api

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

func dashboardPath(org uuid.UUID) string { return orgPath(org) + "/dashboard" }

// P1-24: figures by site / lifecycle / type, org-wide problems, devices missing information and dates coming up —
// only from the caller's organization, narrowed to the topbar category.
func TestDashboard(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	food := mustCategory(t, fx.A, org, "FOOD")
	agri := mustCategory(t, fx.A, org, "AGRI")
	hcm := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM", "categoryId": food}))
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "BD", "categoryId": agri}))
	soon := time.Now().AddDate(0, 0, 10).Format("2006-01-02")
	past := time.Now().AddDate(0, 0, -5).Format("2006-01-02")
	dev := func(site string, body map[string]any) string {
		body["siteId"] = site
		return idOf(t, mustCreate(t, fx.A, devicesPath(org), body))
	}
	sw1 := dev(hcm, map[string]any{"hostname": "SW1", "type": "l2_switch", "serialNumber": "FOC1", "partNumber": "C1300", "model": "C1300", "warrantyEnd": soon})
	sw2 := dev(hcm, map[string]any{"hostname": "SW2", "type": "l2_switch", "serialNumber": "foc1 ", "model": "C1300"})
	dev(hcm, map[string]any{"hostname": "SW3", "type": "l2_switch", "lifecycle": "planned"})
	fw := dev(bd, map[string]any{"hostname": "FW1", "type": "firewall", "serialNumber": "FGT9", "partNumber": "FG-60F", "model": "60F", "eosDate": past})
	dev(bd, map[string]any{"hostname": "OLD", "type": "router", "lifecycle": "retired", "serialNumber": "FOC1"})
	// Same address on two active devices; a /30 with both its hosts used.
	for _, d := range []string{sw1, sw2} {
		v := idOf(t, mustCreate(t, fx.A, devicePath(org, d)+"/interfaces", map[string]any{"name": "Vlan1", "kind": "svi"}))
		mustCreate(t, fx.A, devicePath(org, d)+"/ips", map[string]any{"interfaceId": v, "address": "10.0.0.5/24", "role": "primary"})
	}
	fwIf := idOf(t, mustCreate(t, fx.A, devicePath(org, fw)+"/interfaces", map[string]any{"name": "wan1", "kind": "physical"}))
	mustCreate(t, fx.A, devicePath(org, fw)+"/ips", map[string]any{"interfaceId": fwIf, "address": "100.64.0.1/29", "role": "primary"})
	fwIf2 := idOf(t, mustCreate(t, fx.A, devicePath(org, fw)+"/interfaces", map[string]any{"name": "wan2", "kind": "physical"}))
	mustCreate(t, fx.A, devicePath(org, fw)+"/ips", map[string]any{"interfaceId": fwIf2, "address": "100.64.0.2/29", "role": "primary"})
	// A /29 (6 hosts): 2 used + a DHCP pool of 4 = full. A /30 WAN link with both ends used is full by design: not reported.
	sn := idOf(t, mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "100.64.0.0/29", "siteId": bd}))
	mustCreate(t, fx.A, subnetsPath(org)+"/"+sn+"/ranges", map[string]any{"startIp": "100.64.0.3", "endIp": "100.64.0.6", "kind": "dhcp"})
	fwIf3 := idOf(t, mustCreate(t, fx.A, devicePath(org, fw)+"/interfaces", map[string]any{"name": "wan3", "kind": "physical"}))
	mustCreate(t, fx.A, devicePath(org, fw)+"/ips", map[string]any{"interfaceId": fwIf3, "address": "100.64.1.1/30", "role": "primary"})
	mustCreate(t, fx.A, devicePath(org, fw)+"/ips", map[string]any{"interfaceId": fwIf3, "address": "100.64.1.2/30", "role": "secondary"})
	mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "100.64.1.0/30", "siteId": bd})
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(sw1, ""), "b": devEnd(sw2, ""), "kind": "ethernet"})
	// A port with two cables only comes from old data / outside writes (the API refuses it): insert the second directly.
	p1 := idOf(t, mustCreate(t, fx.A, devicePath(org, sw1)+"/interfaces", map[string]any{"name": "Gi1", "kind": "physical"}))
	p2 := idOf(t, mustCreate(t, fx.A, devicePath(org, sw2)+"/interfaces", map[string]any{"name": "Gi1", "kind": "physical"}))
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(sw1, p1), "b": devEnd(sw2, p2), "kind": "ethernet"})
	if _, err := fx.Pool.Exec(context.Background(), `INSERT INTO links (organization_id, a_kind, a_id, a_interface_id, b_kind, b_id, kind)
		VALUES ($1, 'device', $2, $3, 'device', $4, 'ethernet')`, org, sw1, p1, fw); err != nil {
		t.Fatalf("second cable: %v", err)
	}
	// B's inventory never shows in A's figures; A's dashboard path is closed to B.
	unitB := mustCategory(t, fx.B, fx.OrgB, "FOOD")
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "HCM01", "name": "B", "categoryId": unitB}))
	mustCreate(t, fx.B, devicesPath(fx.OrgB), map[string]any{"hostname": "B-SW", "type": "l2_switch", "siteId": siteB, "serialNumber": "FOC1"})
	fx.AssertCrossTenantDenied(t, "GET", dashboardPath, nil)

	status, d := fx.A.Do("GET", dashboardPath(org), nil)
	if status != http.StatusOK {
		t.Fatalf("dashboard: %d %v", status, d)
	}
	tot := d["totals"].(map[string]any)
	want := map[string]float64{"devices": 4, "active": 3, "planned": 1, "retired": 1, "expiring": 1, "expired": 1, "subnetsFull": 1, "errors": 3, "warnings": 1}
	for k, v := range want {
		if tot[k] != v {
			t.Errorf("totals.%s = %v, want %v (%v)", k, tot[k], v, tot)
		}
	}
	// SW2 lacks a part number; locations are only asked where the site has some. Planned / retired are not asked.
	if tot["missingInfo"] != 1.0 {
		t.Errorf("missing info: %v %v", tot["missingInfo"], d["missingInfo"])
	}
	sites := d["bySite"].([]any)
	if first := sites[0].(map[string]any); first["code"] != "ORG-FOOD-HCM01" || first["total"] != 3.0 || first["planned"] != 1.0 {
		t.Errorf("by site: %v", sites)
	}
	if types := d["byType"].([]any); types[0].(map[string]any)["type"] != "l2_switch" || types[0].(map[string]any)["count"] != 3.0 {
		t.Errorf("by type (retired left out): %v", types)
	}
	kinds := map[string]map[string]any{}
	for _, p := range d["problems"].([]any) {
		kinds[p.(map[string]any)["kind"].(string)] = p.(map[string]any)
	}
	if p := kinds["duplicate_ip"]; p == nil || p["subject"] != "10.0.0.5" || p["severity"] != "error" || p["detail"] != "SW1, SW2" {
		t.Errorf("duplicate IP: %v", p)
	}
	if p := kinds["duplicate_serial"]; p == nil || p["detail"] != "SW1, SW2" {
		t.Errorf("duplicate serial (retired and other org left out): %v", p)
	}
	if p := kinds["subnet_full"]; p == nil || p["subject"] != "100.64.0.0/29" || p["detail"] != "6/6" || p["subnetId"] == nil {
		t.Errorf("subnet out of addresses: %v", p)
	}
	if p := kinds["port_multi_link"]; p == nil || p["subject"] != "SW1 Gi1" || p["count"] != 2.0 {
		t.Errorf("port with two cables: %v", p)
	}
	exp := d["expiring"].([]any)
	if len(exp) != 2 || exp[0].(map[string]any)["kind"] != "warranty" || exp[0].(map[string]any)["days"] != 10.0 ||
		exp[1].(map[string]any)["kind"] != "eos" || exp[1].(map[string]any)["days"] != -5.0 {
		t.Errorf("expiring: coming up first, then past: %v", exp)
	}

	// The topbar category narrows everything.
	_, d = fx.A.Do("GET", dashboardPath(org)+"?categoryId="+agri, nil)
	if tot := d["totals"].(map[string]any); tot["devices"] != 1.0 || tot["errors"] != 0.0 || tot["subnetsFull"] != 1.0 {
		t.Errorf("AGRI only: %v", tot)
	}
	unknown := uuid.NewString()
	if status, _ := fx.A.Do("GET", dashboardPath(org)+"?categoryId="+unknown, nil); status != http.StatusNotFound {
		t.Errorf("unknown category: %d", status)
	}
	if status, _ := fx.A.Do("GET", dashboardPath(org)+"?categoryId="+unitB, nil); status != http.StatusNotFound {
		t.Errorf("another organization's category: %d", status)
	}
}
