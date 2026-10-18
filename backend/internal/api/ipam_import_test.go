package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

// P2-09: IPAM import from a spreadsheet — VLAN, subnet and range per row; existing ones completed, never duplicated;
// bad rows reported and skipped; dryRun writes nothing; editors only; tenant-scoped; audited like the forms.
func TestIpamImport(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	path := func(o uuid.UUID) string { return orgPath(o) + "/ipam-imports" }
	fx.AssertCrossTenantDenied(t, "POST", path, map[string]any{"dryRun": true, "rows": []any{map[string]any{"cidr": "10.9.0.0/24"}}})
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "Văn phòng HCM"}))
	rows := []map[string]any{
		{"site": "hcm01", "vlan": 20, "vlanName": "Camera", "cidr": "10.1.20.0/24", "gateway": "10.1.20.1", "rangeStart": "10.1.20.100",
			"rangeEnd": "10.1.20.200", "rangeKind": "DHCP", "purpose": "Camera"},
		{"site": "Văn phòng HCM", "cidr": "10.1.20.0/24", "rangeStart": "10.1.20.10", "rangeEnd": "10.1.20.50", "rangeKind": "tĩnh"},
		{"site": "HCM01", "cidr": "10.1.20.0/24", "rangeStart": "10.1.20.150", "rangeEnd": "10.1.20.160", "rangeKind": "static"}, // overlaps the pool
		{"cidr": "10.1.30.0/33"},
		{"site": "HN99", "cidr": "10.2.0.0/24"},
		{"vlan": 99, "vlanName": "MGMT"},
		{"vlan": 30, "vlanName": "Bad", "cidr": "10.1.30.0/33"}, // its VLAN is rolled back with the row
		{"cidr": "10.1.20.0/24", "vrf": "Default", "site": "HCM01", "rangeStart": "10.1.20.100", "rangeEnd": "10.1.20.200", "rangeKind": "dhcp"}, // same pool again ("Default" = the default VRF)
	}
	// Preview: nothing written.
	status, res := fx.A.Do("POST", path(org), map[string]any{"dryRun": true, "rows": rows})
	if status != http.StatusOK {
		t.Fatalf("preview: %d %v", status, res)
	}
	if _, list := fx.A.Do("GET", subnetsPath(org), nil); len(list["subnets"].([]any)) != 0 {
		t.Fatalf("preview wrote subnets: %v", list)
	}
	status, res = fx.A.Do("POST", path(org), map[string]any{"dryRun": false, "rows": rows})
	if status != http.StatusOK {
		t.Fatalf("import: %d %v", status, res)
	}
	st := func(i int) string { return res["rows"].([]any)[i].(map[string]any)["status"].(string) }
	want := []string{"created", "created", "error", "error", "error", "created", "error", "unchanged"}
	for i, w := range want {
		if st(i) != w {
			t.Errorf("row %d: %s, want %s (%v)", i, st(i), w, res["rows"].([]any)[i])
		}
	}
	if c := res["created"].(map[string]any); c["vlans"] != float64(2) || c["subnets"] != float64(1) || c["ranges"] != float64(2) {
		t.Errorf("created: %v", c)
	}
	if res["errors"] != float64(4) {
		t.Errorf("errors: %v", res["errors"])
	}
	_, list := fx.A.Do("GET", subnetsPath(org), nil)
	sn := list["subnets"].([]any)
	if len(sn) != 1 || sn[0].(map[string]any)["gateway"] != "10.1.20.1" || sn[0].(map[string]any)["vlanVid"] != float64(20) {
		t.Errorf("subnet: %v", sn)
	}
	// A later file completes the subnet (description was empty) and leaves a different gateway as IPAM has it.
	_, res = fx.A.Do("POST", path(org), map[string]any{"dryRun": false, "rows": []any{
		map[string]any{"site": "HCM01", "cidr": "10.1.20.0/24", "description": "Camera tầng 1-3", "gateway": "10.1.20.254"},
		// A pool row without a subnet column lands in the subnet holding it; same bounds, other kind: kept, reported.
		map[string]any{"rangeStart": "10.1.20.100", "rangeEnd": "10.1.20.200", "rangeKind": "static"},
		map[string]any{"rangeStart": "10.1.20.220", "rangeEnd": "10.1.20.230", "rangeKind": "reserved"},
		map[string]any{"rangeStart": "172.16.0.10", "rangeEnd": "172.16.0.20", "rangeKind": "static"},
	}})
	if st(0) != "updated" || st(1) != "unchanged" || st(2) != "created" || st(3) != "error" {
		t.Errorf("completing: %v", res["rows"])
	}
	acts := func(i int) []any { return res["rows"].([]any)[i].(map[string]any)["actions"].([]any) }
	if len(acts(0)) != 2 || len(acts(1)) != 1 {
		t.Errorf("reported differences: %v / %v", acts(0), acts(1))
	}
	_, list = fx.A.Do("GET", subnetsPath(org), nil)
	if sn := list["subnets"].([]any)[0].(map[string]any); sn["gateway"] != "10.1.20.1" || sn["description"] != "Camera tầng 1-3" {
		t.Errorf("subnet after completing: %v", sn)
	}
	viewer := fx.NewUser(t, "viewer-ipamimp@example.com", false, tenanttest.Member{Org: org, Role: "viewer"})
	if status, _ := viewer.Do("POST", path(org), map[string]any{"dryRun": true, "rows": rows}); status != http.StatusForbidden {
		t.Errorf("viewer importing: %d", status)
	}
	for _, a := range []string{"vlan.create", "subnet.create", "ip_range.create", "subnet.update"} {
		if auditCount(t, fx.Pool, a, org) == 0 {
			t.Errorf("%s not audited", a)
		}
	}
	_ = site
}

// P2-09: an IP plan table on a diagram is bound to a site (of the organization); other notes still cannot be.
func TestIpPlanAnnotation(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "B01", "name": "B"}))
	dg := idOf(t, mustCreate(t, fx.A, diagramsPath(org), map[string]any{"name": "Plan", "layer": "physical"})["diagram"].(map[string]any))
	save := func(version int, ann map[string]any) int {
		v := view([]map[string]any{})
		v["annotations"] = []map[string]any{ann}
		status, _ := fx.A.Do("POST", diagramsPath(org)+"/"+dg+"/save", map[string]any{"version": version, "view": v})
		return status
	}
	if s := save(1, map[string]any{"id": "p1", "kind": "ipPlan", "x": 0, "y": 0, "siteId": site}); s != http.StatusOK {
		t.Fatalf("IP plan bound to a site: %d", s)
	}
	if s := save(2, map[string]any{"id": "t1", "kind": "text", "x": 0, "y": 0, "siteId": site}); s != http.StatusBadRequest {
		t.Errorf("a text note bound to a site: %d", s)
	}
	if s := save(2, map[string]any{"id": "p2", "kind": "ipPlan", "x": 0, "y": 0, "siteId": siteB}); s != http.StatusBadRequest {
		t.Errorf("an IP plan of another organization's site: %d", s)
	}
}
