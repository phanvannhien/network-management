package api

import (
	"net/http"
	"net/url"
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func templatesPath(org uuid.UUID) string { return orgPath(org) + "/device-templates" }
func devicePath(org uuid.UUID, dev string) string {
	return devicesPath(org) + "/" + dev
}

func ifaceNames(t *testing.T, c *tenanttest.Client, org uuid.UUID, dev string) []string {
	t.Helper()
	status, body := c.Do("GET", devicePath(org, dev)+"/interfaces", nil)
	if status != http.StatusOK {
		t.Fatalf("list interfaces: %d %v", status, body)
	}
	out := []string{}
	for _, i := range body["interfaces"].([]any) {
		out = append(out, i.(map[string]any)["name"].(string))
	}
	return out
}

// Cross-tenant isolation for templates, interfaces, IPs and apply-template; plus using another org's template.
func TestInterfaceEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	unitB := mustCategory(t, fx.B, fx.OrgB, "FOOD")
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "HN01", "name": "B", "categoryId": unitB}))
	tplB := idOf(t, mustCreate(t, fx.B, templatesPath(fx.OrgB), map[string]any{"name": "SW24", "type": "l2_switch",
		"ports": []map[string]any{{"pattern": "Gi1/0/{n}", "start": 1, "count": 24, "media": "RJ45"}}}))
	devB := idOf(t, mustCreate(t, fx.B, devicesPath(fx.OrgB), map[string]any{"hostname": "B-SW01", "type": "l2_switch", "siteId": siteB, "templateId": tplB}))
	ifB := idOf(t, mustCreate(t, fx.B, devicePath(fx.OrgB, devB)+"/interfaces", map[string]any{"name": "Vlan10", "kind": "svi"}))
	ipB := idOf(t, mustCreate(t, fx.B, devicePath(fx.OrgB, devB)+"/ips", map[string]any{"interfaceId": ifB, "address": "10.0.0.2/24", "role": "primary"}))
	dev := func(o uuid.UUID) string { return devicePath(o, devB) }
	for _, c := range []struct {
		method string
		path   func(uuid.UUID) string
		body   any
	}{
		{"GET", templatesPath, nil},
		{"POST", templatesPath, map[string]any{"name": "X", "type": "router"}},
		{"GET", func(o uuid.UUID) string { return templatesPath(o) + "/" + tplB }, nil},
		{"GET", func(o uuid.UUID) string { return dev(o) + "/interfaces" }, nil},
		{"POST", func(o uuid.UUID) string { return dev(o) + "/interfaces" }, map[string]any{"name": "Lo0", "kind": "loopback"}},
		{"GET", func(o uuid.UUID) string { return dev(o) + "/ips" }, nil},
		{"POST", func(o uuid.UUID) string { return dev(o) + "/ips" }, map[string]any{"interfaceId": ifB, "address": "10.0.0.3/24", "role": "secondary"}},
		{"POST", func(o uuid.UUID) string { return dev(o) + "/apply-template" }, map[string]any{"templateId": tplB}},
	} {
		fx.AssertCrossTenantDenied(t, c.method, c.path, c.body)
	}
	for _, org := range []uuid.UUID{fx.OrgB, fx.OrgA} {
		for _, r := range []struct {
			method, path string
			body         map[string]any
		}{
			{"PATCH", templatesPath(org) + "/" + tplB, map[string]any{"name": "HACK", "type": "router", "version": 1}},
			{"DELETE", templatesPath(org) + "/" + tplB, nil},
			{"PATCH", dev(org) + "/interfaces/" + ifB, map[string]any{"name": "HACK", "kind": "svi", "version": 1}},
			{"DELETE", dev(org) + "/interfaces/" + ifB, nil},
			{"PATCH", dev(org) + "/ips/" + ipB, map[string]any{"interfaceId": ifB, "address": "1.1.1.1/32", "role": "primary", "version": 1}},
			{"DELETE", dev(org) + "/ips/" + ipB, nil},
		} {
			if status, _ := fx.A.Do(r.method, r.path, r.body); status != http.StatusNotFound {
				t.Errorf("A %s %s: %d, want 404", r.method, r.path, status)
			}
		}
	}
	// A cannot create a device from B's template, nor point A's device at B's interface.
	siteA := idOf(t, mustCreate(t, fx.A, sitesPath(fx.OrgA), map[string]any{"code": "HN01", "name": "A"}))
	if status, _ := fx.A.Do("POST", devicesPath(fx.OrgA), map[string]any{"hostname": "A1", "type": "router", "siteId": siteA, "templateId": tplB}); status != http.StatusBadRequest {
		t.Errorf("device from another org's template: %d, want 400", status)
	}
	devA := idOf(t, mustCreate(t, fx.A, devicesPath(fx.OrgA), map[string]any{"hostname": "A2", "type": "router", "siteId": siteA}))
	if status, _ := fx.A.Do("PATCH", devicePath(fx.OrgA, devA), map[string]any{"hostname": "A2", "type": "router", "siteId": siteA, "mgmtInterfaceId": ifB, "version": 1}); status != http.StatusBadRequest {
		t.Errorf("management interface of another org's device: %d, want 400", status)
	}
	if status, _ := fx.A.Do("POST", devicePath(fx.OrgA, devA)+"/ips", map[string]any{"interfaceId": ifB, "address": "10.9.9.9/24", "role": "primary"}); status != http.StatusBadRequest {
		t.Errorf("IP on another org's interface: %d, want 400", status)
	}
	// B's own control request added Lo0; nothing else changed.
	if n := ifaceNames(t, fx.B, fx.OrgB, devB); len(n) != 26 || n[24] != "Vlan10" || n[25] != "Lo0" {
		t.Errorf("B's interfaces changed: %v", n)
	}
	if _, ips := fx.B.Do("GET", dev(fx.OrgB)+"/ips", nil); ips["ips"].([]any)[0].(map[string]any)["address"] != "10.0.0.2/24" {
		t.Errorf("B's IP changed: %v", ips)
	}
}

func TestTemplatesInterfacesAndManagementIP(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	nm := mustCategory(t, fx.A, org, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "BD", "categoryId": nm}))
	viewer := fx.NewUser(t, "v@example.com", false, tenanttest.Member{Org: org, Role: "viewer"})

	// Templates: validation, editors may write, viewers may not.
	for name, ports := range map[string][]map[string]any{
		"group without {n}": {{"pattern": "Gi1/0/1", "start": 1, "count": 2}},
		"too many ports":    {{"pattern": "p{n}", "start": 1, "count": 512}, {"pattern": "q{n}", "start": 1, "count": 512}, {"pattern": "r{n}", "start": 1, "count": 1}},
		"duplicate names":   {{"pattern": "Gi{n}", "start": 1, "count": 2}, {"pattern": "Gi{n}", "start": 2, "count": 2}},
		"bad media":         {{"pattern": "Gi{n}", "start": 1, "count": 2, "media": "USB"}},
	} {
		if status, _ := fx.A.Do("POST", templatesPath(org), map[string]any{"name": name, "type": "l2_switch", "ports": ports}); status != http.StatusBadRequest {
			t.Errorf("template %s: %d, want 400", name, status)
		}
	}
	if status, _ := viewer.Do("POST", templatesPath(org), map[string]any{"name": "X", "type": "router"}); status != http.StatusForbidden {
		t.Errorf("viewer creates a template: %d, want 403", status)
	}
	tpl := mustCreate(t, fx.A, templatesPath(org), map[string]any{
		"name": "Cisco C9200-24P", "type": "poe_switch", "vendor": "Cisco", "model": "C9200-24P", "partNumber": "C9200-24P-E",
		"ports": []map[string]any{
			{"pattern": "Gi1/0/{n}", "start": 1, "count": 24, "media": "RJ45", "speed": "1G", "poe": true},
			{"pattern": "Te1/1/{n}", "start": 1, "count": 4, "media": "SFP+", "speed": "10G"},
		},
	})
	if tpl["portCount"] != float64(28) {
		t.Errorf("template = %v", tpl)
	}
	tplID := idOf(t, tpl)
	if status, _ := fx.A.Do("POST", templatesPath(org), map[string]any{"name": "cisco c9200-24p", "type": "router"}); status != http.StatusConflict {
		t.Errorf("duplicate template name: %d, want 409", status)
	}

	// A device from the template gets its ports and defaults; user values win.
	sw := mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "BD-SW01", "type": "poe_switch", "siteId": bd, "templateId": tplID, "model": "C9200-24P-4G"})
	if sw["vendor"] != "Cisco" || sw["model"] != "C9200-24P-4G" || sw["partNumber"] != "C9200-24P-E" {
		t.Errorf("template defaults: %v", sw)
	}
	swID := idOf(t, sw)
	names := ifaceNames(t, fx.A, org, swID)
	if len(names) != 28 || names[0] != "Gi1/0/1" || names[27] != "Te1/1/4" {
		t.Errorf("generated ports: %v", names)
	}
	// Applying again adds nothing; after adding a port group, only the new ports appear.
	if status, body := fx.A.Do("POST", devicePath(org, swID)+"/apply-template", map[string]any{"templateId": tplID}); status != http.StatusOK || body["added"] != float64(0) {
		t.Errorf("re-apply: %d %v", status, body)
	}
	// Port groups typed on the spot (no template): added once; both or neither is refused.
	groups := []map[string]any{{"pattern": "Gi0/{n}", "start": 1, "count": 2, "media": "RJ45", "speed": "1G"}}
	if status, body := fx.A.Do("POST", devicePath(org, swID)+"/apply-template", map[string]any{"ports": groups}); status != http.StatusOK || body["added"] != float64(2) {
		t.Errorf("ad-hoc ports: %d %v", status, body)
	}
	if status, _ := fx.A.Do("POST", devicePath(org, swID)+"/apply-template", map[string]any{"ports": groups, "templateId": tplID}); status != http.StatusBadRequest {
		t.Errorf("template and ports together: %d", status)
	}
	if status, _ := fx.A.Do("POST", devicePath(org, swID)+"/apply-template", map[string]any{}); status != http.StatusBadRequest {
		t.Errorf("neither template nor ports: %d", status)
	}

	// Virtual interfaces, LAG membership and validation.
	ifPath := devicePath(org, swID) + "/interfaces"
	svi := idOf(t, mustCreate(t, fx.A, ifPath, map[string]any{"name": "Vlan10", "kind": "svi", "description": "MGMT"}))
	po := idOf(t, mustCreate(t, fx.A, ifPath, map[string]any{"name": "Po1", "kind": "lag", "mode": "trunk", "allowedVlans": "10,20-30"}))
	var te1 string
	_, list := fx.A.Do("GET", ifPath, nil)
	for _, i := range list["interfaces"].([]any) {
		if i.(map[string]any)["name"] == "Te1/1/1" {
			te1 = i.(map[string]any)["id"].(string)
		}
	}
	for name, c := range map[string]struct {
		method, path string
		body         map[string]any
		want         int
	}{
		"duplicate name (case)":   {"POST", ifPath, map[string]any{"name": "vlan10", "kind": "svi"}, http.StatusConflict},
		"bad VLAN":                {"POST", ifPath, map[string]any{"name": "Vlan5000", "kind": "svi", "accessVlan": 5000}, http.StatusBadRequest},
		"bad allowed list":        {"POST", ifPath, map[string]any{"name": "Po2", "kind": "lag", "allowedVlans": "10,abc"}, http.StatusBadRequest},
		"allowed VLAN too high":   {"POST", ifPath, map[string]any{"name": "Po3", "kind": "lag", "allowedVlans": "10-5000"}, http.StatusBadRequest},
		"LAG parent is not a LAG": {"PATCH", ifPath + "/" + te1, map[string]any{"name": "Te1/1/1", "kind": "physical", "lagId": svi, "version": 1}, http.StatusBadRequest},
		"member of the LAG":       {"PATCH", ifPath + "/" + te1, map[string]any{"name": "Te1/1/1", "kind": "physical", "media": "SFP+", "lagId": po, "version": 1}, http.StatusOK},
		"viewer edits":            {"POST", ifPath, map[string]any{"name": "Lo0", "kind": "loopback"}, http.StatusForbidden},
	} {
		c := c
		client := fx.A
		if name == "viewer edits" {
			client = viewer
		}
		if status, body := client.Do(c.method, c.path, c.body); status != c.want {
			t.Errorf("%s: %d %v, want %d", name, status, body, c.want)
		}
	}

	// IPs: on an interface; NAT/public may sit on the device; one primary per family.
	ipPath := devicePath(org, swID) + "/ips"
	mustCreate(t, fx.A, ipPath, map[string]any{"interfaceId": svi, "address": "10.72.114.2/24", "role": "primary"})
	mustCreate(t, fx.A, ipPath, map[string]any{"address": "203.0.113.10", "role": "nat"})
	for name, c := range map[string]struct {
		body map[string]any
		want int
	}{
		"second primary":           {map[string]any{"interfaceId": svi, "address": "10.72.114.3/24", "role": "primary"}, http.StatusConflict},
		"IPv6 primary is separate": {map[string]any{"interfaceId": svi, "address": "2001:db8::2/64", "role": "primary"}, http.StatusCreated},
		"primary without iface":    {map[string]any{"address": "10.1.1.1/24", "role": "primary"}, http.StatusBadRequest},
		"garbage":                  {map[string]any{"interfaceId": svi, "address": "10.1.1/24", "role": "secondary"}, http.StatusBadRequest},
		"same IP twice":            {map[string]any{"interfaceId": svi, "address": "10.72.114.2/24", "role": "secondary"}, http.StatusConflict},
	} {
		if status, body := fx.A.Do("POST", ipPath, c.body); status != c.want {
			t.Errorf("ip %s: %d %v, want %d", name, status, body, c.want)
		}
	}

	// Management interface → management IP in the device and the list; sort and search by IP.
	_, cur := fx.A.Do("GET", devicePath(org, swID), nil)
	upd := map[string]any{"hostname": "BD-SW01", "type": "poe_switch", "siteId": bd, "mgmtInterfaceId": svi, "pollAddress": "203.0.113.10", "version": cur["version"]}
	if status, body := fx.A.Do("PATCH", devicePath(org, swID), upd); status != http.StatusOK || body["mgmtIp"] != "10.72.114.2/24" || body["mgmtInterfaceName"] != "Vlan10" || body["pollAddress"] != "203.0.113.10" {
		t.Fatalf("set management interface: %d %v", status, body)
	}
	fw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "BD-FW01", "type": "firewall", "siteId": bd}))
	fwIf := idOf(t, mustCreate(t, fx.A, devicePath(org, fw)+"/interfaces", map[string]any{"name": "mgmt", "kind": "physical"}))
	mustCreate(t, fx.A, devicePath(org, fw)+"/ips", map[string]any{"interfaceId": fwIf, "address": "10.72.114.1/24", "role": "primary"})
	_, fwCur := fx.A.Do("GET", devicePath(org, fw), nil)
	if status, _ := fx.A.Do("PATCH", devicePath(org, fw), map[string]any{"hostname": "BD-FW01", "type": "firewall", "siteId": bd, "mgmtInterfaceId": fwIf, "version": fwCur["version"]}); status != http.StatusOK {
		t.Fatalf("fw management interface: %d", status)
	}
	if got := hostnamesOf(t, listDevices(t, fx.A, org, url.Values{"sort": {"mgmtIp"}})); !slices.Equal(got, []string{"BD-FW01", "BD-SW01"}) {
		t.Errorf("sort by management IP: %v", got)
	}
	if got := hostnamesOf(t, listDevices(t, fx.A, org, url.Values{"q": {"10.72.114.2"}})); !slices.Equal(got, []string{"BD-SW01"}) {
		t.Errorf("search by IP: %v", got)
	}
	if status, _ := fx.A.Do("PATCH", devicePath(org, fw), map[string]any{"hostname": "BD-FW01", "type": "firewall", "siteId": bd, "pollAddress": "10.0.0.0/8", "version": 1}); status != http.StatusBadRequest {
		t.Errorf("poll address with a prefix: %d, want 400", status)
	}
	// Deleting the management interface clears the management IP; its IPs go with it.
	if status, _ := fx.A.Do("DELETE", ifPath+"/"+svi, nil); status != http.StatusNoContent {
		t.Fatalf("delete interface: %d", status)
	}
	if _, got := fx.A.Do("GET", devicePath(org, swID), nil); got["mgmtIp"] != "" || got["mgmtInterfaceId"] != nil {
		t.Errorf("after deleting the management interface: %v %v", got["mgmtIp"], got["mgmtInterfaceId"])
	}
	if _, ips := fx.A.Do("GET", ipPath, nil); len(ips["ips"].([]any)) != 1 || ips["ips"].([]any)[0].(map[string]any)["role"] != "nat" {
		t.Errorf("IPs left: %v", ips)
	}
	// The device history shows interface / IP changes.
	_, hist := fx.A.Do("GET", devicePath(org, swID)+"/history", nil)
	actions := map[string]bool{}
	for _, e := range hist["entries"].([]any) {
		actions[e.(map[string]any)["action"].(string)] = true
	}
	for _, a := range []string{"interface.create", "interface.update", "interface.delete", "ip.create", "device.apply_template"} {
		if !actions[a] {
			t.Errorf("history lacks %s: %v", a, actions)
		}
	}
}

func TestInterfacePermissions(t *testing.T) {
	w := newRoleWorld(t)
	org := w.fx.OrgA
	sw := idOf(t, mustCreate(t, w.fx.A, devicesPath(org), map[string]any{"hostname": "BD-SW01", "type": "l2_switch", "siteId": w.site}))
	if status, _ := w.editor.Do("POST", devicePath(org, sw)+"/interfaces", map[string]any{"name": "Vlan10", "kind": "svi"}); status != http.StatusCreated {
		t.Errorf("editor adds an interface: %d", status)
	}
	if status, _ := w.viewer.Do("POST", devicePath(org, sw)+"/interfaces", map[string]any{"name": "Vlan20", "kind": "svi"}); status != http.StatusForbidden {
		t.Errorf("viewer adds an interface: %d, want 403", status)
	}
	if status, _ := w.viewer.Do("GET", devicePath(org, sw)+"/ips", nil); status != http.StatusOK {
		t.Errorf("viewer reads IPs: %d", status)
	}
	if status, _ := w.viewer.Do("GET", templatesPath(org), nil); status != http.StatusOK {
		t.Errorf("viewer reads templates: %d", status)
	}
	if status, _ := w.viewer.Do("POST", templatesPath(org), map[string]any{"name": "X", "type": "router"}); status != http.StatusForbidden {
		t.Errorf("viewer writes a template: %d, want 403", status)
	}
}

// Stack members get their own port numbers ({m}); MAC is normalized and searchable; dot1q tags only on sub-interfaces.
func TestStackPortsMACAndSubinterfaceTag(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	nm := mustCategory(t, fx.A, org, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "BD", "categoryId": nm}))
	tpl := idOf(t, mustCreate(t, fx.A, templatesPath(org), map[string]any{"name": "C9300-24", "type": "l3_switch",
		"ports": []map[string]any{{"pattern": "Gi{m}/0/{n}", "start": 1, "count": 24, "media": "RJ45"}}}))
	stack := idOf(t, mustCreate(t, fx.A, clustersPath(org), map[string]any{"kind": "stack", "name": "CORE", "siteId": bd}))
	sw1 := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "CORE", "type": "l3_switch", "siteId": bd, "templateId": tpl, "clusterId": stack, "clusterMemberNo": 1}))
	sw2 := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "CORE", "type": "l3_switch", "siteId": bd, "templateId": tpl, "clusterId": stack, "clusterMemberNo": 2}))
	lone := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "LONE", "type": "l3_switch", "siteId": bd, "templateId": tpl}))
	for dev, want := range map[string]string{sw1: "Gi1/0/1", sw2: "Gi2/0/1", lone: "Gi1/0/1"} {
		if n := ifaceNames(t, fx.A, org, dev); len(n) != 24 || n[0] != want {
			t.Errorf("ports of %s: %v…, want %s first", dev, n[:1], want)
		}
	}
	ifPath := devicePath(org, sw2) + "/interfaces"
	created := mustCreate(t, fx.A, ifPath, map[string]any{"name": "Vlan1", "kind": "svi", "mac": "AABB.CCDD.EE01"})
	if created["mac"] != "aa:bb:cc:dd:ee:01" {
		t.Errorf("MAC stored as %v", created["mac"])
	}
	if got := hostnamesOf(t, listDevices(t, fx.A, org, url.Values{"q": {"AA:BB:CC:DD:EE"}})); len(got) != 1 {
		t.Errorf("search by MAC: %v", got)
	}
	for name, c := range map[string]struct {
		body map[string]any
		want int
	}{
		"bad MAC":                  {map[string]any{"name": "Vlan2", "kind": "svi", "mac": "zz:zz"}, http.StatusBadRequest},
		"tag on a physical port":   {map[string]any{"name": "Gi9", "kind": "physical", "vlanTag": 10}, http.StatusBadRequest},
		"tag out of range":         {map[string]any{"name": "Gi2/0/1.5000", "kind": "subinterface", "vlanTag": 5000}, http.StatusBadRequest},
		"router-on-a-stick sub-if": {map[string]any{"name": "Gi2/0/1.10", "kind": "subinterface", "vlanTag": 10}, http.StatusCreated},
	} {
		if status, body := fx.A.Do("POST", ifPath, c.body); status != c.want {
			t.Errorf("%s: %d %v, want %d", name, status, body, c.want)
		}
	}
}
