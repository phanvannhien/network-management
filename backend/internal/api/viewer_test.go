package api

import (
	"net/http"
	"testing"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

// MVP gate (SRS §16): a viewer cannot change anything — checked at the API for the write endpoints that had no
// viewer test of their own. Every refused write must leave the data as it was (status 403, no 2xx).
func TestViewerCannotWrite(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	viewer := fx.NewUser(t, "viewer-gate@example.com", false, tenanttest.Member{Org: org, Role: "viewer"})
	o := orgPath(org)
	cat := mustCategory(t, fx.A, org, "FOOD")
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HN01", "name": "HN", "categoryId": cat}))
	loc := idOf(t, mustCreate(t, fx.A, o+"/sites/"+site+"/locations", map[string]any{"kind": "room", "name": "Phòng máy"}))
	rack := idOf(t, mustCreate(t, fx.A, o+"/sites/"+site+"/racks", map[string]any{"name": "R1", "locationId": loc, "uHeight": 42}))
	tpl := idOf(t, mustCreate(t, fx.A, templatesPath(org), map[string]any{"name": "SW8", "type": "l2_switch",
		"ports": []map[string]any{{"pattern": "Gi{n}", "start": 1, "count": 8, "media": "RJ45"}}}))
	dev := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "SW1", "type": "l2_switch", "siteId": site}))
	dev2 := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "SW2", "type": "l2_switch", "siteId": site}))
	ifc := idOf(t, mustCreate(t, fx.A, devicePath(org, dev)+"/interfaces", map[string]any{"name": "Vlan1", "kind": "svi"}))
	ip := idOf(t, mustCreate(t, fx.A, devicePath(org, dev)+"/ips", map[string]any{"interfaceId": ifc, "address": "10.0.0.2/24", "role": "primary"}))
	cl := idOf(t, mustCreate(t, fx.A, clustersPath(org), map[string]any{"kind": "stack", "name": "ST", "siteId": site}))
	link := idOf(t, mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(dev, ""), "b": devEnd(dev2, ""), "kind": "ethernet"}))
	vlan := idOf(t, mustCreate(t, fx.A, vlansPath(org), map[string]any{"vid": 10, "name": "DATA", "siteId": site}))
	sn := idOf(t, mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.0.0.0/24", "siteId": site}))
	rg := idOf(t, mustCreate(t, fx.A, subnetsPath(org)+"/"+sn+"/ranges", map[string]any{"startIp": "10.0.0.100", "endIp": "10.0.0.200", "kind": "dhcp"}))
	field := idOf(t, mustCreate(t, fx.A, fieldsPath(org), map[string]any{"key": "contract", "label": "Hợp đồng", "kind": "text"}))

	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"POST", o + "/sites/" + site + "/locations", map[string]any{"kind": "room", "name": "X"}},
		{"PATCH", o + "/sites/" + site + "/locations/" + loc, map[string]any{"name": "X", "version": 1}},
		{"DELETE", o + "/sites/" + site + "/locations/" + loc, nil},
		{"POST", o + "/sites/" + site + "/racks", map[string]any{"name": "R2", "locationId": loc, "uHeight": 42}},
		{"PATCH", o + "/sites/" + site + "/racks/" + rack, map[string]any{"name": "R9", "locationId": loc, "uHeight": 42, "version": 1}},
		{"DELETE", o + "/sites/" + site + "/racks/" + rack, nil},
		{"PATCH", templatesPath(org) + "/" + tpl, map[string]any{"name": "X", "type": "l2_switch", "ports": []any{}, "version": 1}},
		{"DELETE", templatesPath(org) + "/" + tpl, nil},
		{"POST", o + "/device-templates/from-catalog", map[string]any{"catalogId": "cisco-c1300-24t-4g"}},
		{"PATCH", devicePath(org, dev) + "/interfaces/" + ifc, map[string]any{"name": "Vlan9", "kind": "svi", "version": 1}},
		{"DELETE", devicePath(org, dev) + "/interfaces/" + ifc, nil},
		{"POST", devicePath(org, dev) + "/ips", map[string]any{"interfaceId": ifc, "address": "10.0.0.3/24", "role": "secondary"}},
		{"PATCH", devicePath(org, dev) + "/ips/" + ip, map[string]any{"interfaceId": ifc, "address": "10.0.0.4/24", "role": "primary", "version": 1}},
		{"DELETE", devicePath(org, dev) + "/ips/" + ip, nil},
		{"PUT", devicePath(org, dev) + "/mgmt-ip", map[string]any{"address": "10.0.0.9"}},
		{"POST", devicePath(org, dev) + "/apply-template", map[string]any{"templateId": tpl}},
		{"POST", clustersPath(org), map[string]any{"kind": "stack", "name": "ST2", "siteId": site}},
		{"DELETE", clustersPath(org) + "/" + cl, nil},
		{"POST", groupsPath(org), map[string]any{"siteId": site, "kind": "pc", "name": "PC"}},
		{"PATCH", linksPath(org) + "/" + link, map[string]any{"a": devEnd(dev, ""), "b": devEnd(dev2, ""), "kind": "fiber", "version": 1}},
		{"PATCH", vlansPath(org) + "/" + vlan, map[string]any{"vid": 10, "name": "X", "siteId": site, "version": 1}},
		{"DELETE", vlansPath(org) + "/" + vlan, nil},
		{"POST", subnetsPath(org), map[string]any{"cidr": "10.1.0.0/24", "siteId": site}},
		{"PATCH", subnetsPath(org) + "/" + sn + "/ranges/" + rg, map[string]any{"startIp": "10.0.0.100", "endIp": "10.0.0.150", "kind": "dhcp", "version": 1}},
		{"DELETE", subnetsPath(org) + "/" + sn + "/ranges/" + rg, nil},
		{"PATCH", fieldsPath(org) + "/" + field, map[string]any{"label": "X", "version": 1}},
		{"DELETE", fieldsPath(org) + "/" + field, nil},
		{"POST", o + "/device-imports", map[string]any{"matchBy": "hostname", "rows": []any{}, "clusters": []any{}}},
		{"POST", o + "/ntb-imports", map[string]any{"file": map[string]any{}, "siteMap": map[string]any{}, "deviceActions": map[string]any{}, "diagramName": "X"}},
	} {
		if status, body := viewer.Do(c.method, c.path, c.body); status != http.StatusForbidden {
			t.Errorf("viewer %s %s: %d %v", c.method, c.path, status, body)
		}
	}
	// Nothing changed.
	if _, ips := fx.A.Do("GET", devicePath(org, dev)+"/ips", nil); len(ips["ips"].([]any)) != 1 {
		t.Errorf("ips changed: %v", ips)
	}
	if status, _ := fx.A.Do("GET", clustersPath(org)+"/"+cl, nil); status != http.StatusOK {
		t.Errorf("cluster gone: %d", status)
	}
}
