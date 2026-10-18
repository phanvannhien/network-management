package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func reportPath(org uuid.UUID, kind string) string { return orgPath(org) + "/reports/" + kind }

// P2-11: reports read the organization's data only, scoped by site / category; every member may read them.
func TestReports(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	for _, kind := range []string{"ip-plan", "vlans", "port-map", "boq"} {
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
	if l := lines["active/C9200L-24P-4G-E"]; l == nil || l["quantity"] != float64(3) || len(l["sites"].([]any)) != 2 {
		t.Errorf("active line: %v", l)
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
	if _, r := fx.A.Do("GET", reportPath(org, "port-map")+"?siteId="+siteB, nil); len(r["devices"].([]any)) != 0 {
		t.Errorf("A's report scoped to B's site: %v", r)
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
