package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func linksPath(org uuid.UUID) string { return orgPath(org) + "/links" }

func devEnd(id, iface string) map[string]any {
	e := map[string]any{"kind": "device", "id": id}
	if iface != "" {
		e["interfaceId"] = iface
	}
	return e
}

// Cross-tenant isolation for every link endpoint, plus linking another org's device or port.
func TestLinkEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	unitB := mustCategory(t, fx.B, fx.OrgB, "FOOD")
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "HN01", "name": "B", "categoryId": unitB}))
	sw := idOf(t, mustCreate(t, fx.B, devicesPath(fx.OrgB), map[string]any{"hostname": "B-SW1", "type": "l2_switch", "siteId": siteB}))
	fw := idOf(t, mustCreate(t, fx.B, devicesPath(fx.OrgB), map[string]any{"hostname": "B-FW1", "type": "firewall", "siteId": siteB}))
	p1 := idOf(t, mustCreate(t, fx.B, devicePath(fx.OrgB, sw)+"/interfaces", map[string]any{"name": "Gi1/0/1", "kind": "physical"}))
	lB := idOf(t, mustCreate(t, fx.B, linksPath(fx.OrgB), map[string]any{"a": devEnd(sw, p1), "b": devEnd(fw, ""), "kind": "ethernet"}))
	fx.AssertCrossTenantDenied(t, "GET", linksPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", linksPath, map[string]any{"a": devEnd(sw, ""), "b": devEnd(fw, ""), "kind": "logical"})
	for _, org := range []uuid.UUID{fx.OrgB, fx.OrgA} {
		for _, r := range []struct {
			method string
			body   map[string]any
		}{
			{"PATCH", map[string]any{"a": devEnd(sw, ""), "b": devEnd(fw, ""), "kind": "fiber", "version": 1}},
			{"DELETE", nil},
		} {
			if status, _ := fx.A.Do(r.method, linksPath(org)+"/"+lB, r.body); status != http.StatusNotFound {
				t.Errorf("A %s link in %s: %d, want 404", r.method, org, status)
			}
		}
	}
	nm := mustCategory(t, fx.A, fx.OrgA, "AGRI")
	siteA := idOf(t, mustCreate(t, fx.A, sitesPath(fx.OrgA), map[string]any{"code": "BD01", "name": "A", "categoryId": nm}))
	devA := idOf(t, mustCreate(t, fx.A, devicesPath(fx.OrgA), map[string]any{"hostname": "A-SW1", "type": "l2_switch", "siteId": siteA}))
	if status, _ := fx.A.Do("POST", linksPath(fx.OrgA), map[string]any{"a": devEnd(devA, ""), "b": devEnd(fw, ""), "kind": "ethernet"}); status != http.StatusBadRequest {
		t.Errorf("link to another org's device: %d, want 400", status)
	}
	if status, _ := fx.A.Do("POST", linksPath(fx.OrgA), map[string]any{"a": devEnd(devA, p1), "b": devEnd(devA, ""), "kind": "ethernet"}); status != http.StatusBadRequest {
		t.Errorf("link on another org's port: %d, want 400", status)
	}
	_, got := fx.B.Do("GET", linksPath(fx.OrgB), nil)
	for _, l := range got["links"].([]any) {
		if l := l.(map[string]any); l["id"] == lB && (l["kind"] != "ethernet" || l["version"] != float64(1)) {
			t.Errorf("B's link changed: %v", l)
		}
	}
}

func TestLinkRules(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	nm := mustCategory(t, fx.A, org, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "BD", "categoryId": nm}))
	hn := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HN01", "name": "HN", "categoryId": nm}))
	sw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "BD-SW01", "type": "l2_switch", "siteId": bd}))
	fw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "BD-FW01", "type": "firewall", "siteId": bd}))
	hq := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "HN-FW01", "type": "firewall", "siteId": hn}))
	port := func(dev, name, kind string) string {
		return idOf(t, mustCreate(t, fx.A, devicePath(org, dev)+"/interfaces", map[string]any{"name": name, "kind": kind}))
	}
	g1, g2, svi := port(sw, "Gi1/0/1", "physical"), port(sw, "Gi1/0/2", "physical"), port(sw, "Vlan10", "svi")
	po1 := port(sw, "Po1", "lag")
	fwPort, fwTun, hqTun := port(fw, "port1", "physical"), port(fw, "VPN-HN", "tunnel"), port(hq, "VPN-BD", "tunnel")
	grp := idOf(t, mustCreate(t, fx.A, groupsPath(org), map[string]any{"kind": "ip_camera", "name": "CAM", "siteId": bd}))
	grp2 := idOf(t, mustCreate(t, fx.A, groupsPath(org), map[string]any{"kind": "pc", "name": "PC", "siteId": bd}))
	gEnd := func(id string) map[string]any { return map[string]any{"kind": "endpoint_group", "id": id} }
	for name, c := range map[string]struct {
		body map[string]any
		want int
	}{
		"physical link on an SVI":     {map[string]any{"a": devEnd(sw, svi), "b": devEnd(fw, fwPort), "kind": "ethernet"}, http.StatusBadRequest},
		"VPN on a LAG":                {map[string]any{"a": devEnd(sw, po1), "b": devEnd(hq, hqTun), "kind": "logical"}, http.StatusBadRequest},
		"cable on a LAG":              {map[string]any{"a": devEnd(sw, po1), "b": devEnd(fw, ""), "kind": "ethernet"}, http.StatusBadRequest},
		"port of another device":      {map[string]any{"a": devEnd(fw, g1), "b": devEnd(sw, g2), "kind": "ethernet"}, http.StatusBadRequest},
		"same port twice":             {map[string]any{"a": devEnd(sw, g1), "b": devEnd(sw, g1), "kind": "ethernet"}, http.StatusBadRequest},
		"device to itself, no ports":  {map[string]any{"a": devEnd(sw, ""), "b": devEnd(sw, ""), "kind": "ethernet"}, http.StatusBadRequest},
		"group with a port":           {map[string]any{"a": devEnd(sw, g2), "b": map[string]any{"kind": "endpoint_group", "id": grp, "interfaceId": g1}, "kind": "ethernet"}, http.StatusBadRequest},
		"group to group":              {map[string]any{"a": gEnd(grp), "b": gEnd(grp2), "kind": "ethernet"}, http.StatusBadRequest},
		"unknown device":              {map[string]any{"a": devEnd(uuid.NewString(), ""), "b": devEnd(sw, ""), "kind": "ethernet"}, http.StatusBadRequest},
		"bad kind":                    {map[string]any{"a": devEnd(sw, ""), "b": devEnd(fw, ""), "kind": "copper"}, http.StatusBadRequest},
		"negative length":             {map[string]any{"a": devEnd(sw, ""), "b": devEnd(fw, ""), "kind": "ethernet", "lengthM": -2}, http.StatusBadRequest},
		"same switch, two ports (ok)": {map[string]any{"a": devEnd(sw, g1), "b": devEnd(sw, g2), "kind": "ethernet", "status": "planned"}, http.StatusCreated},
	} {
		if status, body := fx.A.Do("POST", linksPath(org), c.body); status != c.want {
			t.Errorf("link %s: %d %v, want %d", name, status, body, c.want)
		}
	}
	// One physical link per physical port: the loop above took Gi1/0/1 and Gi1/0/2.
	if status, _ := fx.A.Do("POST", linksPath(org), map[string]any{"a": devEnd(sw, g1), "b": devEnd(fw, fwPort), "kind": "ethernet"}); status != http.StatusConflict {
		t.Errorf("second cable on Gi1/0/1: %d, want 409", status)
	}
	g3 := port(sw, "Gi1/0/3", "physical")
	up := mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(sw, g3), "b": devEnd(fw, fwPort), "kind": "fiber", "medium": "OM4",
		"speed": "10G", "lengthM": 12.5, "cableId": "BD-C001"})
	if up["a"].(map[string]any)["interfaceName"] != "Gi1/0/3" || up["b"].(map[string]any)["name"] != "BD-FW01" || up["lengthM"] != 12.5 || up["status"] != "up" || up["access"] != "edit" {
		t.Errorf("link stored as %v", up)
	}
	// Logical links do not take ports: a VPN between tunnels, many logical links per device, a link without ports.
	vpn := mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(fw, fwTun), "b": devEnd(hq, hqTun), "kind": "logical", "medium": "VPN/IPsec",
		"provider": "VNPT", "circuitId": "VN-123", "bandwidth": "100 Mbps"})
	if vpn["b"].(map[string]any)["siteCode"] != "ORG-AGRI-HN01" || vpn["circuitId"] != "VN-123" {
		t.Errorf("VPN stored as %v", vpn)
	}
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": gEnd(grp), "b": devEnd(sw, ""), "kind": "ethernet"})
	// Moving a link onto a taken port conflicts; moving it to a free port works; stale versions conflict.
	upID := idOf(t, up)
	if status, _ := fx.A.Do("PATCH", linksPath(org)+"/"+upID, map[string]any{"a": devEnd(sw, g1), "b": devEnd(fw, fwPort), "kind": "fiber", "version": 1}); status != http.StatusConflict {
		t.Errorf("move onto a taken port: %d, want 409", status)
	}
	g4 := port(sw, "Gi1/0/4", "physical")
	if status, body := fx.A.Do("PATCH", linksPath(org)+"/"+upID, map[string]any{"a": devEnd(sw, g4), "b": devEnd(fw, fwPort), "kind": "fiber", "version": 1}); status != http.StatusOK || body["a"].(map[string]any)["interfaceName"] != "Gi1/0/4" {
		t.Errorf("move to a free port: %d %v", status, body)
	}
	if status, _ := fx.A.Do("PATCH", linksPath(org)+"/"+upID, map[string]any{"a": devEnd(sw, g4), "b": devEnd(fw, fwPort), "kind": "fiber", "version": 1}); status != http.StatusConflict {
		t.Errorf("stale link: %d, want 409", status)
	}
	// Filters: by end and by site (either end).
	_, bySw := fx.A.Do("GET", linksPath(org)+"?endId="+sw, nil)
	_, byHn := fx.A.Do("GET", linksPath(org)+"?siteId="+hn, nil)
	if len(bySw["links"].([]any)) != 3 || len(byHn["links"].([]any)) != 1 {
		t.Errorf("filters: by switch %d, by HN %d", len(bySw["links"].([]any)), len(byHn["links"].([]any)))
	}
	// Deleting a device or a group takes its links along; deleting an interface leaves the link without a port.
	if status, _ := fx.A.Do("DELETE", devicePath(org, sw)+"/interfaces/"+g4, nil); status != http.StatusNoContent {
		t.Errorf("delete interface: %d", status)
	}
	if _, l := fx.A.Do("GET", linksPath(org)+"?endId="+fw, nil); len(l["links"].([]any)) != 2 {
		t.Errorf("links of the firewall: %v", l)
	}
	if status, _ := fx.A.Do("DELETE", devicePath(org, hq), nil); status != http.StatusNoContent {
		t.Errorf("delete device: %d", status)
	}
	if status, _ := fx.A.Do("DELETE", groupsPath(org)+"/"+grp, nil); status != http.StatusNoContent {
		t.Errorf("delete group: %d", status)
	}
	if _, all := fx.A.Do("GET", linksPath(org), nil); len(all["links"].([]any)) != 2 {
		t.Errorf("links after deletes: %v", all)
	}
	if status, _ := fx.A.Do("DELETE", linksPath(org)+"/"+upID, nil); status != http.StatusNoContent {
		t.Errorf("delete link: %d", status)
	}
	for _, a := range []string{"link.create", "link.update", "link.delete"} {
		if auditCount(t, fx.Pool, a, org) == 0 {
			t.Errorf("no %s audit", a)
		}
	}
}

func TestLinkPermissions(t *testing.T) {
	w := newRoleWorld(t)
	org := w.fx.OrgA
	sw := idOf(t, mustCreate(t, w.fx.A, devicesPath(org), map[string]any{"hostname": "BD-SW", "type": "l2_switch", "siteId": w.site}))
	fw := idOf(t, mustCreate(t, w.fx.A, devicesPath(org), map[string]any{"hostname": "HN-FW", "type": "firewall", "siteId": w.other}))
	vpn := idOf(t, mustCreate(t, w.editor, linksPath(org), map[string]any{"a": devEnd(sw, ""), "b": devEnd(fw, ""), "kind": "logical"}))
	if _, l := w.viewer.Do("GET", linksPath(org), nil); len(l["links"].([]any)) != 1 || l["links"].([]any)[0].(map[string]any)["access"] != "view" {
		t.Errorf("viewer sees %v", l)
	}
	if status, _ := w.viewer.Do("DELETE", linksPath(org)+"/"+vpn, nil); status != http.StatusForbidden {
		t.Errorf("viewer deletes a link: %d, want 403", status)
	}
	if status, _ := w.viewer.Do("POST", linksPath(org), map[string]any{"a": devEnd(sw, ""), "b": devEnd(fw, ""), "kind": "ethernet"}); status != http.StatusForbidden {
		t.Errorf("viewer creates a link: %d, want 403", status)
	}
}

// ADR-033: per-kind rules — port media, ports that are not exclusive, power and stack ends, provider clouds.
func TestLinkKindRules(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "BD"}))
	dev := func(host, typ string, extra map[string]any) string {
		body := map[string]any{"hostname": host, "type": typ, "siteId": bd}
		for k, v := range extra {
			body[k] = v
		}
		return idOf(t, mustCreate(t, fx.A, devicesPath(org), body))
	}
	port := func(d, name, kind, media string) string {
		return idOf(t, mustCreate(t, fx.A, devicePath(org, d)+"/interfaces", map[string]any{"name": name, "kind": kind, "media": media}))
	}
	sw, fw, ap, ups, olt := dev("SW01", "l2_switch", nil), dev("FW01", "firewall", nil), dev("AP01", "access_point", nil),
		dev("UPS01", "ups", nil), dev("OLT01", "olt", nil)
	ont1, ont2, modem := dev("ONT01", "ont", nil), dev("ONT02", "ont", nil), dev("MDM01", "modem", nil)
	inet := dev("Internet", "provider_cloud", map[string]any{"managed": true})
	// Two clouds may share a name, and a cloud is never managed.
	inet2 := mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "Internet", "type": "provider_cloud", "siteId": bd})
	if inet2["managed"] != false {
		t.Errorf("provider cloud managed: %v", inet2["managed"])
	}
	rj, sfp, radio, pon := port(sw, "Gi1/0/1", "physical", "RJ45"), port(sw, "Te1/1/1", "physical", "SFP+"),
		port(ap, "radio0", "physical", "Radio"), port(olt, "pon0/1", "physical", "PON")
	outlet, fwWan := port(ups, "outlet1", "physical", ""), port(fw, "wan1", "physical", "RJ45")
	inetPort := port(inet, "x", "physical", "")
	c1 := idOf(t, mustCreate(t, fx.A, clustersPath(org), map[string]any{"kind": "stack", "name": "ST1", "hostname": "ST1", "siteId": bd}))
	c2 := idOf(t, mustCreate(t, fx.A, clustersPath(org), map[string]any{"kind": "stack", "name": "ST2", "hostname": "ST2", "siteId": bd}))
	m1, m2 := dev("M1", "l2_switch", map[string]any{"clusterId": c1}), dev("M2", "l2_switch", map[string]any{"clusterId": c2})
	for name, c := range map[string]struct {
		body map[string]any
		want int
	}{
		"fibre into an RJ45 port":        {map[string]any{"a": devEnd(sw, rj), "b": devEnd(fw, ""), "kind": "fiber"}, http.StatusBadRequest},
		"DAC (copper) into SFP+ (ok)":    {map[string]any{"a": devEnd(sw, sfp), "b": devEnd(fw, ""), "kind": "ethernet", "medium": "DAC"}, http.StatusCreated},
		"wireless on RJ45":               {map[string]any{"a": devEnd(sw, rj), "b": devEnd(ap, ""), "kind": "wireless"}, http.StatusBadRequest},
		"power without UPS/PDU":          {map[string]any{"a": devEnd(sw, ""), "b": devEnd(fw, ""), "kind": "power"}, http.StatusBadRequest},
		"power on the device's port":     {map[string]any{"a": devEnd(ups, ""), "b": devEnd(fw, fwWan), "kind": "power"}, http.StatusBadRequest},
		"power from a UPS outlet (ok)":   {map[string]any{"a": devEnd(ups, outlet), "b": devEnd(fw, ""), "kind": "power"}, http.StatusCreated},
		"power to a group":               {map[string]any{"a": devEnd(ups, ""), "b": map[string]any{"kind": "endpoint_group", "id": uuid.NewString()}, "kind": "power"}, http.StatusBadRequest},
		"stack across two clusters":      {map[string]any{"a": devEnd(m1, ""), "b": devEnd(m2, ""), "kind": "stack"}, http.StatusBadRequest},
		"port on a provider cloud":       {map[string]any{"a": devEnd(modem, ""), "b": devEnd(inet, inetPort), "kind": "dsl"}, http.StatusBadRequest},
		"DSL modem to the Internet (ok)": {map[string]any{"a": devEnd(modem, ""), "b": devEnd(inet, ""), "kind": "dsl", "service": "internet_broadband"}, http.StatusCreated},
		"VPN on the WAN port (ok)":       {map[string]any{"a": devEnd(fw, fwWan), "b": devEnd(inet, ""), "kind": "logical"}, http.StatusCreated},
		"bad service":                    {map[string]any{"a": devEnd(fw, ""), "b": devEnd(sw, ""), "kind": "ethernet", "service": "p2p"}, http.StatusBadRequest},
	} {
		if status, body := fx.A.Do("POST", linksPath(org), c.body); status != c.want {
			t.Errorf("%s: %d %v, want %d", name, status, body, c.want)
		}
	}
	// A radio serves many clients and a PON port many ONTs; a copper port takes one cable.
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(ap, radio), "b": devEnd(fw, ""), "kind": "wireless"})
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(ap, radio), "b": devEnd(sw, ""), "kind": "wireless"})
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(olt, pon), "b": devEnd(ont1, ""), "kind": "fiber", "fiberMode": "sm", "connector": "SC"})
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(olt, pon), "b": devEnd(ont2, ""), "kind": "fiber"})
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(sw, rj), "b": devEnd(fw, ""), "kind": "ethernet"})
	if status, _ := fx.A.Do("POST", linksPath(org), map[string]any{"a": devEnd(sw, rj), "b": devEnd(ap, ""), "kind": "ethernet"}); status != http.StatusConflict {
		t.Errorf("second cable on RJ45: %d, want 409", status)
	}
	// Fibre mode / connector are kept for fibre and cleared for other kinds.
	l := mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(fw, ""), "b": devEnd(ont1, ""), "kind": "ethernet", "fiberMode": "mm", "connector": "LC"})
	if l["fiberMode"] != "" || l["connector"] != "" {
		t.Errorf("copper link kept fibre fields: %v", l)
	}
}
