package api

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func designPath(org uuid.UUID, what string) string { return orgPath(org) + "/design-templates/" + what }

// P2-23: every scenario × vendor × option set gives a design the inventory accepts as is — no import warning (a port,
// an address skipped), no org-wide problem (duplicate IP, a port with two cables), planned devices, IPAM filled.
func TestDesignTemplates(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	cat := mustCategory(t, fx.A, org, "MAU")
	fx.AssertCrossTenantDenied(t, "POST", func(o uuid.UUID) string { return designPath(o, "preview") },
		map[string]any{"scenario": "small", "vendor": "fortinet_cisco", "users": 20})
	viewer := fx.NewUser(t, "viewer-design@example.com", false, tenanttest.Member{Org: org, Role: "viewer"})
	if status, _ := viewer.Do("POST", designPath(org, "apply"), map[string]any{"scenario": "small", "vendor": "fortinet_cisco", "users": 20}); status != http.StatusForbidden {
		t.Errorf("viewer apply: %d", status)
	}

	cases := []map[string]any{
		{"scenario": "small", "vendor": "fortinet_cisco", "users": 30, "phones": true, "cameras": true, "guestWifi": true},
		{"scenario": "small", "vendor": "fortinet_aruba", "users": 50, "ha": true, "remoteVpn": true},
		{"scenario": "small", "vendor": "tplink_omada", "users": 15},
		{"scenario": "small", "vendor": "ubiquiti", "users": 45, "cameras": true},
		{"scenario": "medium", "vendor": "fortinet_cisco", "users": 100, "ha": true, "phones": true, "cameras": true, "remoteVpn": true},
		{"scenario": "medium", "vendor": "fortinet_aruba", "users": 80, "guestWifi": true},
		{"scenario": "medium", "vendor": "tplink_omada", "users": 90, "phones": true},
		{"scenario": "medium", "vendor": "ubiquiti", "users": 70, "cameras": true},
		{"scenario": "branches", "vendor": "fortinet_cisco", "users": 80, "branches": 3, "branchUsers": 40, "ha": true, "remoteVpn": true, "phones": true},
		{"scenario": "branches", "vendor": "ubiquiti", "users": 40, "branches": 2, "branchUsers": 30},
	}
	for i, c := range cases {
		c["categoryId"] = cat
		c["diagramName"] = fmt.Sprintf("Mẫu %d", i)
		name := fmt.Sprintf("%v/%v/%v", c["scenario"], c["vendor"], c["users"])
		status, prev := fx.A.Do("POST", designPath(org, "preview"), c)
		if status != http.StatusOK {
			t.Fatalf("%s preview: %d %v", name, status, prev)
		}
		if w := prev["warnings"].([]any); len(w) != 0 {
			t.Errorf("%s preview warnings: %v", name, w)
		}
		// Preview writes nothing.
		if _, list := fx.A.Do("GET", diagramsPath(org), nil); len(list["diagrams"].([]any)) != i {
			t.Fatalf("%s: preview left a diagram behind", name)
		}
		status, res := fx.A.Do("POST", designPath(org, "apply"), c)
		if status != http.StatusCreated {
			t.Fatalf("%s apply: %d %v", name, status, res)
		}
		tot := prev["totals"].(map[string]any)
		if res["devices"] == 0.0 || res["cables"] != tot["cables"] || res["sites"] != tot["sites"] {
			t.Errorf("%s: result %v, preview totals %v", name, res, tot)
		}
	}
	_, d := fx.A.Do("GET", dashboardPath(org), nil)
	if tot := d["totals"].(map[string]any); tot["errors"] != 0.0 || tot["warnings"] != 0.0 || tot["active"] != 0.0 {
		t.Errorf("dashboard after the designs: %v problems %v", tot, d["problems"])
	}
	// The medium HA design: FortiGate pair, core stack, gateways on the core, IP plan in IPAM.
	_, list := fx.A.Do("GET", devicesPath(org)+"?q=CORE01&pageSize=50", nil)
	if len(list["devices"].([]any)) == 0 {
		t.Fatalf("no core switch")
	}
	core := list["devices"].([]any)[0].(map[string]any)
	if core["lifecycle"] != "planned" || core["model"] == "" {
		t.Errorf("core: %v", core)
	}
	_, subnets := fx.A.Do("GET", subnetsPath(org), nil)
	if n := len(subnets["subnets"].([]any)); n < 20 {
		t.Errorf("IP plan: %d subnets", n)
	}
	// The Cisco core: the firewall lands on a data port, never the out-of-band Gi0/0; guest Wi-Fi is routed on the
	// firewall, not the core.
	_, fwList := fx.A.Do("GET", devicesPath(org)+"?q=FW01&pageSize=100", nil)
	for _, x := range fwList["devices"].([]any) {
		fw := x.(map[string]any)
		_, links := fx.A.Do("GET", linksPath(org)+"?endId="+fw["id"].(string), nil)
		for _, l := range links["links"].([]any) {
			for _, end := range []string{"a", "b"} {
				e := l.(map[string]any)[end].(map[string]any)
				if p, _ := e["interfaceName"].(string); p == "GigabitEthernet0/0" || p == "mgmt" {
					t.Errorf("%s cabled to an out-of-band port: %v", fw["hostname"], l)
				}
			}
		}
	}
	// The default name takes a number when used; a typed name already used is refused.
	plain := map[string]any{"scenario": "small", "vendor": "tplink_omada", "users": 10}
	for i := 0; i < 2; i++ {
		if status, body := fx.A.Do("POST", designPath(org, "apply"), plain); status != http.StatusCreated {
			t.Fatalf("default name %d: %d %v", i, status, body)
		}
	}
	if status, _ := fx.A.Do("POST", designPath(org, "apply"), map[string]any{"scenario": "small", "vendor": "tplink_omada", "users": 10, "diagramName": "Mẫu 0"}); status != http.StatusBadRequest {
		t.Errorf("typed name already used: %d", status)
	}
	// Refusals.
	for _, c := range []map[string]any{
		{"scenario": "small", "vendor": "tplink_omada", "users": 20, "ha": true},
		{"scenario": "branches", "vendor": "fortinet_cisco", "users": 20},
		{"scenario": "small", "vendor": "nope", "users": 20},
		{"scenario": "small", "vendor": "fortinet_cisco", "users": 120},
	} {
		if status, _ := fx.A.Do("POST", designPath(org, "preview"), c); status != http.StatusBadRequest {
			t.Errorf("refused %v: %d", c, status)
		}
	}
}
