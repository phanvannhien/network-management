package api

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func reportPath(org uuid.UUID, kind string) string { return orgPath(org) + "/reports/" + kind }

// P2-11: reports read the organization's data only, scoped by site / category; every member may read them.
func TestReports(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	for _, kind := range []string{"ip-plan", "vlans", "port-map", "boq", "expiring", "missing-info", "inventory"} {
		fx.AssertCrossTenantDenied(t, "GET", func(o uuid.UUID) string { return reportPath(o, kind) }, nil)
	}
	catA := mustCategory(t, fx.A, org, "NORTH")
	hn := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HN01", "name": "Hà Nội", "categoryId": catA}))
	hcm := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))
	vlan := idOf(t, mustCreate(t, fx.A, vlansPath(org), map[string]any{"vid": 20, "name": "Camera", "siteId": hn}))
	mustCreate(t, fx.A, vlansPath(org), map[string]any{"vid": 99, "name": "MGMT"}) // organization-wide
	sn := idOf(t, mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.1.20.0/24", "gateway": "10.1.20.1", "siteId": hn, "vlanId": vlan}))
	mustCreate(t, fx.A, subnetsPath(org)+"/"+sn+"/ranges", map[string]any{"startIp": "10.1.20.100", "endIp": "10.1.20.200", "kind": "dhcp", "purpose": "Camera"})
	mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.2.0.0/24", "siteId": hcm})
	dev := func(host, typ, site, lifecycle, part string, managed bool) string {
		return idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{
			"hostname": host, "type": typ, "siteId": site, "lifecycle": lifecycle, "vendor": "Cisco", "model": "C9200L-24P-4G",
			"partNumber": part, "managed": managed,
		}))
	}
	sw1 := dev("HN-SW1", "poe_switch", hn, "active", "C9200L-24P-4G-E", true)
	sw2 := dev("HN-SW2", "poe_switch", hn, "active", "C9200L-24P-4G-E", true)
	dev("HN-SW3", "poe_switch", hn, "planned", "C9200L-24P-4G-E", true)
	dev("HCM-SW1", "poe_switch", hcm, "active", "C9200L-24P-4G-E", true)
	dev("HN-ONT", "ont", hn, "active", "", false) // the ISP's box: not in our BOQ
	port := func(d, name string, body map[string]any) string {
		body["name"], body["kind"] = name, "physical"
		return idOf(t, mustCreate(t, fx.A, devicePath(org, d)+"/interfaces", body))
	}
	up1 := port(sw1, "Gi1/0/24", map[string]any{"mode": "trunk", "allowedVlans": "1-30", "nativeVlan": 99})
	up2 := port(sw2, "Gi1/0/24", map[string]any{"mode": "trunk", "allowedVlans": "20,99"})
	port(sw1, "Gi1/0/1", map[string]any{"mode": "access", "accessVlan": 20, "description": "CAM-01"})
	port(sw1, "Gi1/0/2", map[string]any{}) // free
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(sw1, up1), "b": devEnd(sw2, up2), "kind": "ethernet", "cableId": "C-001"})
	// A logical link (VPN) on the same port as the cable: the port map shows the cable.
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(sw1, up1), "b": devEnd(sw2, ""), "kind": "logical"})
	// Same part number, model spelled differently, same site: one BOQ line, the site column adds up.
	mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "HN-SW4", "type": "poe_switch", "siteId": hn,
		"lifecycle": "active", "vendor": "Cisco", "model": "Catalyst 9200L", "partNumber": "C9200L-24P-4G-E "})

	// IP plan: the site's subnet with its VLAN, mask and pool; the category keeps HCM out.
	status, ip := fx.A.Do("GET", reportPath(org, "ip-plan")+"?categoryId="+catA, nil)
	if status != http.StatusOK {
		t.Fatalf("ip plan: %d %v", status, ip)
	}
	subnets := ip["subnets"].([]any)
	if len(subnets) != 1 {
		t.Fatalf("ip plan in category: %v", subnets)
	}
	row := subnets[0].(map[string]any)
	if row["mask"] != "255.255.255.0" || row["vlanVid"] != float64(20) || !strings.HasSuffix(row["siteCode"].(string), "HN01") || len(row["ranges"].([]any)) != 1 {
		t.Errorf("ip plan row: %v", row)
	}
	if _, all := fx.A.Do("GET", reportPath(org, "ip-plan"), nil); len(all["subnets"].([]any)) != 2 {
		t.Errorf("ip plan, whole organization: %v", all)
	}

	// VLANs: 20 on one access port and two trunks; the organization-wide 99 is native on one trunk, allowed on the other.
	_, vl := fx.A.Do("GET", reportPath(org, "vlans")+"?siteId="+hn, nil)
	got := map[float64]map[string]any{}
	for _, v := range vl["vlans"].([]any) {
		got[v.(map[string]any)["vid"].(float64)] = v.(map[string]any)
	}
	if v := got[20]; v == nil || v["accessPorts"] != float64(1) || v["trunkPorts"] != float64(2) || len(v["subnets"].([]any)) != 1 {
		t.Errorf("VLAN 20: %v", v)
	}
	if v := got[99]; v == nil || v["trunkPorts"] != float64(2) || v["siteCode"] != "" {
		t.Errorf("VLAN 99: %v", v)
	}

	// Port map: every port, free ones too, the trunk naming the far end and the cable.
	_, pm := fx.A.Do("GET", reportPath(org, "port-map")+"?siteId="+hn, nil)
	var sw1Ports []any
	for _, d := range pm["devices"].([]any) {
		if d.(map[string]any)["hostname"] == "HN-SW1" {
			sw1Ports = d.(map[string]any)["ports"].([]any)
		}
	}
	if len(sw1Ports) != 3 {
		t.Fatalf("HN-SW1 ports: %v", sw1Ports)
	}
	for _, p := range sw1Ports {
		p := p.(map[string]any)
		if p["name"] == "Gi1/0/24" && (p["peerName"] != "HN-SW2" || p["peerPort"] != "Gi1/0/24" || p["cableId"] != "C-001") {
			t.Errorf("uplink: %v", p)
		}
		if p["name"] == "Gi1/0/2" && p["peerKind"] != "" {
			t.Errorf("free port: %v", p)
		}
	}

	// BOQ: in use and planned on separate lines; HCM counted per site; the ISP's ONT left out.
	_, boq := fx.A.Do("GET", reportPath(org, "boq"), nil)
	lines := map[string]map[string]any{}
	for _, l := range boq["lines"].([]any) {
		l := l.(map[string]any)
		lines[l["lifecycle"].(string)+"/"+l["partNumber"].(string)] = l
		if l["type"] == "ont" {
			t.Errorf("unmanaged box in the BOQ: %v", l)
		}
	}
	if l := lines["active/C9200L-24P-4G-E"]; l == nil || l["quantity"] != float64(4) || len(l["sites"].([]any)) != 2 {
		t.Errorf("active line: %v", l)
	} else {
		sum := 0.0
		for _, st := range l["sites"].([]any) {
			sum += st.(map[string]any)["quantity"].(float64)
		}
		if sum != 4 {
			t.Errorf("site columns add up to %v: %v", sum, l["sites"])
		}
	}
	if l := lines["planned/C9200L-24P-4G-E"]; l == nil || l["quantity"] != float64(1) {
		t.Errorf("planned line: %v", l)
	}

	// A viewer reads reports too; B's member cannot reach A's through A's organization (AssertCrossTenantDenied above).
	viewer := fx.NewUser(t, "viewer-reports@example.com", false, tenanttest.Member{Org: org, Role: "viewer"})
	if status, _ := viewer.Do("GET", reportPath(org, "boq"), nil); status != http.StatusOK {
		t.Errorf("viewer reading the BOQ: %d", status)
	}
	// Scoping by another organization's site or category finds nothing of A's either.
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "B01", "name": "B"}))
	catB := mustCategory(t, fx.B, fx.OrgB, "BCAT")
	for _, kind := range []string{"ip-plan", "vlans", "port-map", "boq", "expiring", "missing-info", "inventory"} {
		if status, _ := fx.A.Do("GET", reportPath(org, kind)+"?siteId="+siteB, nil); status != http.StatusNotFound {
			t.Errorf("%s scoped to B's site: %d, want 404", kind, status)
		}
		if status, _ := fx.A.Do("GET", reportPath(org, kind)+"?categoryId="+catB, nil); status != http.StatusNotFound {
			t.Errorf("%s scoped to B's category: %d, want 404", kind, status)
		}
	}
}

func TestVlanListHas(t *testing.T) {
	for _, c := range []struct {
		list string
		vid  int
		want bool
	}{
		{"10,20,30-39", 35, true},
		{"10, 20", 20, true},
		{"10,20,30-39", 40, false},
		{"", 1, false},
	} {
		if got := vlanListHas(c.list, c.vid); got != c.want {
			t.Errorf("vlanListHas(%q, %d) = %v", c.list, c.vid, got)
		}
	}
}

// P2-11: expiry (overdue and within the window, muted devices too, contracts), missing information with one
// definition (ADR-052), device counts.
func TestReportLists(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HN01", "name": "HN"}))
	day := func(d int) string { return time.Now().AddDate(0, 0, d).Format("2006-01-02") }
	mk := func(body map[string]any) string {
		body["siteId"] = site
		if body["lifecycle"] == nil {
			body["lifecycle"] = "active"
		}
		return idOf(t, mustCreate(t, fx.A, devicesPath(org), body))
	}
	fw := mk(map[string]any{"hostname": "FW1", "type": "firewall", "vendor": "Fortinet", "model": "FG-60F", "serialNumber": "S1",
		"warrantyEnd": day(20), "licenseEnd": day(-5)})
	mk(map[string]any{"hostname": "SW1", "type": "l2_switch", "eosDate": day(80)})                          // missing S/N and model
	mk(map[string]any{"hostname": "SW2", "type": "l2_switch", "warrantyEnd": day(200), "partNumber": "P1"}) // out of the window; missing S/N only
	mk(map[string]any{"hostname": "PC1", "type": "pc"})                                                     // end-user device: not asked
	mk(map[string]any{"hostname": "OLD", "type": "router", "lifecycle": "retired", "warrantyEnd": day(1)})
	if status, _ := fx.A.Do("PUT", devicePath(org, fw)+"/alerts-muted", map[string]any{"muted": true}); status >= 300 {
		t.Fatalf("mute: %d", status)
	}
	vendor := idOf(t, mustCreate(t, fx.A, vendorsPath(org), map[string]any{"name": "FPT", "kind": "isp"}))
	mustCreate(t, fx.A, contractsPath(org), map[string]any{"vendorId": vendor, "name": "Internet HN", "kind": "isp", "endDate": day(45)})

	_, ex := fx.A.Do("GET", reportPath(org, "expiring")+"?days=90", nil)
	var got []string
	for _, it := range ex["items"].([]any) {
		it := it.(map[string]any)
		got = append(got, fmt.Sprintf("%s:%s:%v", it["subject"], it["kind"], it["days"]))
	}
	want := []string{"FW1:license:-5", "FW1:warranty:20", "Internet HN:contract:45", "SW1:eos:80"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("expiring: %v, want %v", got, want)
	}
	if _, ex30 := fx.A.Do("GET", reportPath(org, "expiring")+"?days=30", nil); len(ex30["items"].([]any)) != 2 {
		t.Errorf("30-day window: %v", ex30["items"])
	}

	_, mi := fx.A.Do("GET", reportPath(org, "missing-info"), nil)
	miss := map[string]string{}
	for _, d := range mi["devices"].([]any) {
		d := d.(map[string]any)
		var f []string
		for _, x := range d["missing"].([]any) {
			f = append(f, x.(string))
		}
		miss[d["hostname"].(string)] = strings.Join(f, ",")
	}
	if len(miss) != 2 || miss["SW1"] != "serial,model" || miss["SW2"] != "serial" {
		t.Errorf("missing info: %v", miss)
	}
	// The dashboard counts the same devices.
	if _, dash := fx.A.Do("GET", dashboardPath(org), nil); dash["totals"].(map[string]any)["missingInfo"] != float64(2) {
		t.Errorf("dashboard missing info: %v", dash["totals"])
	}

	_, inv := fx.A.Do("GET", reportPath(org, "inventory"), nil)
	total := 0
	for _, r := range inv["rows"].([]any) {
		total += int(r.(map[string]any)["quantity"].(float64))
	}
	if total != 5 {
		t.Errorf("inventory rows: %v", inv["rows"])
	}
}
