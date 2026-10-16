package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func groupsPath(org uuid.UUID) string { return orgPath(org) + "/endpoint-groups" }

// Cross-tenant isolation for every endpoint-group endpoint, plus linking another org's range or port.
func TestEndpointGroupEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	_, unitB := mustPartnerUnit(t, fx.B, fx.OrgB, "FOOD")
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "FOOD-HN01", "name": "B", "businessUnitId": unitB}))
	snB := idOf(t, mustCreate(t, fx.B, subnetsPath(fx.OrgB), map[string]any{"cidr": "10.0.0.0/24", "siteId": siteB}))
	rgB := idOf(t, mustCreate(t, fx.B, subnetsPath(fx.OrgB)+"/"+snB+"/ranges", map[string]any{"startIp": "10.0.0.100", "endIp": "10.0.0.200", "kind": "static"}))
	swB := idOf(t, mustCreate(t, fx.B, devicesPath(fx.OrgB), map[string]any{"hostname": "B-SW1", "type": "poe_switch", "siteId": siteB}))
	portB := idOf(t, mustCreate(t, fx.B, devicePath(fx.OrgB, swB)+"/interfaces", map[string]any{"name": "Gi1/0/1", "kind": "physical"}))
	gB := idOf(t, mustCreate(t, fx.B, groupsPath(fx.OrgB), map[string]any{"kind": "ip_camera", "name": "CAM", "siteId": siteB, "ipRangeId": rgB}))
	mB := idOf(t, mustCreate(t, fx.B, groupsPath(fx.OrgB)+"/"+gB+"/members", map[string]any{"name": "CAM-01", "ip": "10.0.0.101", "interfaceId": portB}))
	g := func(o uuid.UUID) string { return groupsPath(o) + "/" + gB }
	fx.AssertCrossTenantDenied(t, "GET", groupsPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", groupsPath, map[string]any{"kind": "pc", "name": "PC", "siteId": siteB})
	fx.AssertCrossTenantDenied(t, "GET", g, nil)
	for _, org := range []uuid.UUID{fx.OrgB, fx.OrgA} {
		for _, r := range []struct {
			method, path string
			body         map[string]any
		}{
			{"PATCH", g(org), map[string]any{"kind": "pc", "name": "HACK", "siteId": siteB, "version": 1}},
			{"POST", g(org) + "/members", map[string]any{"name": "X"}},
			{"PATCH", g(org) + "/members/" + mB, map[string]any{"name": "HACK", "version": 1}},
			{"POST", g(org) + "/members/" + mB + "/promote", map[string]any{}},
			{"DELETE", g(org) + "/members/" + mB, nil},
			{"DELETE", g(org), nil},
		} {
			if status, _ := fx.A.Do(r.method, r.path, r.body); status != http.StatusNotFound {
				t.Errorf("A %s %s: %d, want 404", r.method, r.path, status)
			}
		}
	}
	// Org A cannot link B's range or plug into B's switch port.
	_, nm := mustPartnerUnit(t, fx.A, fx.OrgA, "AGRI")
	siteA := idOf(t, mustCreate(t, fx.A, sitesPath(fx.OrgA), map[string]any{"code": "AGRI-BD01", "name": "A", "businessUnitId": nm}))
	if status, _ := fx.A.Do("POST", groupsPath(fx.OrgA), map[string]any{"kind": "pc", "name": "PC", "siteId": siteA, "ipRangeId": rgB}); status != http.StatusBadRequest {
		t.Errorf("group with another org's range: %d, want 400", status)
	}
	gA := idOf(t, mustCreate(t, fx.A, groupsPath(fx.OrgA), map[string]any{"kind": "pc", "name": "PC", "siteId": siteA}))
	if status, _ := fx.A.Do("POST", groupsPath(fx.OrgA)+"/"+gA+"/members", map[string]any{"name": "PC-01", "interfaceId": portB}); status != http.StatusBadRequest {
		t.Errorf("member on another org's port: %d, want 400", status)
	}
	_, got := fx.B.Do("GET", g(fx.OrgB), nil)
	if got["name"] != "CAM" || len(got["members"].([]any)) != 1 || got["members"].([]any)[0].(map[string]any)["name"] != "CAM-01" {
		t.Errorf("B's group changed: %v", got)
	}
}

func TestEndpointGroupRulesAndIpam(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	_, nm := mustPartnerUnit(t, fx.A, org, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "AGRI-BD01", "name": "BD", "businessUnitId": nm}))
	hn := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "AGRI-HN01", "name": "HN", "businessUnitId": nm}))
	sn := idOf(t, mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.72.120.0/26", "gateway": "10.72.120.1", "siteId": bd, "vrf": "OT"}))
	cams := idOf(t, mustCreate(t, fx.A, subnetsPath(org)+"/"+sn+"/ranges", map[string]any{"startIp": "10.72.120.2", "endIp": "10.72.120.21", "kind": "static", "purpose": "Camera"}))
	other := idOf(t, mustCreate(t, fx.A, subnetsPath(org)+"/"+sn+"/ranges", map[string]any{"startIp": "10.72.120.30", "endIp": "10.72.120.40", "kind": "reserved"}))
	hnNet := idOf(t, mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.80.0.0/24", "siteId": hn}))
	hnRange := idOf(t, mustCreate(t, fx.A, subnetsPath(org)+"/"+hnNet+"/ranges", map[string]any{"startIp": "10.80.0.10", "endIp": "10.80.0.20", "kind": "static"}))
	for name, body := range map[string]map[string]any{
		"bad kind":           {"kind": "router", "name": "X", "siteId": bd},
		"no name":            {"kind": "pc", "name": " ", "siteId": bd},
		"negative expected":  {"kind": "pc", "name": "X", "siteId": bd, "expectedCount": -1},
		"range of HN in BD":  {"kind": "pc", "name": "X", "siteId": bd, "ipRangeId": hnRange},
		"unknown range":      {"kind": "pc", "name": "X", "siteId": bd, "ipRangeId": uuid.NewString()},
		"unit of other site": {"kind": "pc", "name": "X", "siteId": bd, "businessUnitId": uuid.NewString()},
	} {
		if status, _ := fx.A.Do("POST", groupsPath(org), body); status != http.StatusBadRequest {
			t.Errorf("group %s: %d, want 400", name, status)
		}
	}
	grp := mustCreate(t, fx.A, groupsPath(org), map[string]any{"kind": "ip_camera", "name": "Camera xưởng", "siteId": bd, "ipRangeId": cams})
	if grp["total"] != float64(20) || grp["subnetCidr"] != "10.72.120.0/26" || grp["vrf"] != "OT" || grp["rangeKind"] != "static" {
		t.Errorf("group stored as %v", grp)
	}
	gid := idOf(t, grp)
	if status, _ := fx.A.Do("POST", groupsPath(org), map[string]any{"kind": "pc", "name": "camera XƯỞNG", "siteId": bd}); status != http.StatusConflict {
		t.Errorf("duplicate group name in a site: %d, want 409", status)
	}
	mustCreate(t, fx.A, groupsPath(org), map[string]any{"kind": "pc", "name": "Camera xưởng", "siteId": hn})

	// Members: IP inside the range, MAC normalised, physical port of a device in the same site.
	sw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "BD-SW01", "type": "poe_switch", "siteId": bd}))
	port := idOf(t, mustCreate(t, fx.A, devicePath(org, sw)+"/interfaces", map[string]any{"name": "Gi1/0/5", "kind": "physical"}))
	svi := idOf(t, mustCreate(t, fx.A, devicePath(org, sw)+"/interfaces", map[string]any{"name": "Vlan20", "kind": "svi"}))
	hnSw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "HN-SW01", "type": "poe_switch", "siteId": hn}))
	hnPort := idOf(t, mustCreate(t, fx.A, devicePath(org, hnSw)+"/interfaces", map[string]any{"name": "Gi1/0/1", "kind": "physical"}))
	members := groupsPath(org) + "/" + gid + "/members"
	for name, c := range map[string]struct {
		body map[string]any
		want int
	}{
		"IP outside the range": {map[string]any{"name": "CAM-X", "ip": "10.72.120.25"}, http.StatusBadRequest},
		"bad IP":               {map[string]any{"name": "CAM-X", "ip": "10.72.120"}, http.StatusBadRequest},
		"bad MAC":              {map[string]any{"name": "CAM-X", "mac": "zz:zz"}, http.StatusBadRequest},
		"virtual port":         {map[string]any{"name": "CAM-X", "interfaceId": svi}, http.StatusBadRequest},
		"port in another site": {map[string]any{"name": "CAM-X", "interfaceId": hnPort}, http.StatusBadRequest},
		"unknown port":         {map[string]any{"name": "CAM-X", "interfaceId": uuid.NewString()}, http.StatusBadRequest},
	} {
		if status, body := fx.A.Do("POST", members, c.body); status != c.want {
			t.Errorf("member %s: %d %v, want %d", name, status, body, c.want)
		}
	}
	m1 := mustCreate(t, fx.A, members, map[string]any{"name": "CAM-01", "ip": "10.72.120.2", "mac": "AABB.CCDD.EE01", "interfaceId": port})
	if m1["address"] != "10.72.120.2/26" || m1["mac"] != "aa:bb:cc:dd:ee:01" || m1["portHostname"] != "BD-SW01" || m1["interfaceName"] != "Gi1/0/5" {
		t.Errorf("member stored as %v", m1)
	}
	mustCreate(t, fx.A, members, map[string]any{"name": "CAM-02", "ip": "10.72.120.3"})
	mustCreate(t, fx.A, members, map[string]any{"name": "CAM-03"}) // DHCP / not yet known
	if status, _ := fx.A.Do("POST", members, map[string]any{"name": "CAM-04", "ip": "10.72.120.3"}); status != http.StatusConflict {
		t.Errorf("duplicate member IP: %d, want 409", status)
	}
	if status, _ := fx.A.Do("POST", members, map[string]any{"name": "cam-01"}); status != http.StatusConflict {
		t.Errorf("duplicate member name: %d, want 409", status)
	}
	_, detail := fx.A.Do("GET", groupsPath(org)+"/"+gid, nil)
	if detail["memberCount"] != float64(3) || detail["total"] != float64(20) {
		t.Errorf("group counts: %v / %v", detail["memberCount"], detail["total"])
	}
	// Member IPs are in use for IPAM: usage, next free (same VRF), lookup.
	_, subnet := fx.A.Do("GET", subnetsPath(org)+"/"+sn, nil)
	if subnet["usedCount"] != float64(2) {
		t.Errorf("subnet usage with members: %v, want 2", subnet["usedCount"])
	}
	if _, next := fx.A.Do("GET", subnetsPath(org)+"/"+sn+"/next-free", nil); next["host"] != "10.72.120.4" {
		t.Errorf("next free skips member IPs: %v", next)
	}
	_, found := fx.A.Do("GET", lookupPath(org, "10.72.120.2"), nil)
	if as := found["assignments"].([]any); len(as) != 1 || as[0].(map[string]any)["endpointGroupId"] != gid || as[0].(map[string]any)["hostname"] != "CAM-01" || as[0].(map[string]any)["vrf"] != "OT" {
		t.Errorf("lookup of a member IP: %v", found)
	}
	// Expected count beats the range size; relinking must keep members inside the range.
	if status, upd := fx.A.Do("PATCH", groupsPath(org)+"/"+gid, map[string]any{"kind": "ip_camera", "name": "Camera xưởng", "siteId": bd, "ipRangeId": cams, "expectedCount": 12, "version": 1}); status != http.StatusOK || upd["total"] != float64(12) {
		t.Errorf("expected count: %d %v", status, upd["total"])
	}
	if status, _ := fx.A.Do("PATCH", groupsPath(org)+"/"+gid, map[string]any{"kind": "ip_camera", "name": "Camera xưởng", "siteId": bd, "ipRangeId": other, "version": 2}); status != http.StatusBadRequest {
		t.Errorf("relink with members outside: %d, want 400", status)
	}
	if status, _ := fx.A.Do("PATCH", groupsPath(org)+"/"+gid, map[string]any{"kind": "ip_camera", "name": "X", "siteId": bd, "version": 1}); status != http.StatusConflict {
		t.Errorf("stale group: %d, want 409", status)
	}
	// A site / unit with groups cannot be deleted.
	if status, _ := fx.A.Do("DELETE", sitesPath(org)+"/"+hn, nil); status != http.StatusConflict {
		t.Errorf("delete a site with a group: %d, want 409", status)
	}
	for _, a := range []string{"endpoint_group.create", "endpoint_group.update", "endpoint_member.create"} {
		if auditCount(t, fx.Pool, a, org) == 0 {
			t.Errorf("no %s audit", a)
		}
	}
}

func TestPromoteEndpointMember(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	_, nm := mustPartnerUnit(t, fx.A, org, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "AGRI-BD01", "name": "BD", "businessUnitId": nm}))
	sn := idOf(t, mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.72.120.0/24", "siteId": bd, "vrf": "OT"}))
	rg := idOf(t, mustCreate(t, fx.A, subnetsPath(org)+"/"+sn+"/ranges", map[string]any{"startIp": "10.72.120.2", "endIp": "10.72.120.50", "kind": "static"}))
	sw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "BD-SW01", "type": "poe_switch", "siteId": bd}))
	port := idOf(t, mustCreate(t, fx.A, devicePath(org, sw)+"/interfaces", map[string]any{"name": "Gi1/0/5", "kind": "physical"}))
	gid := idOf(t, mustCreate(t, fx.A, groupsPath(org), map[string]any{"kind": "ip_camera", "name": "CAM", "siteId": bd, "ipRangeId": rg}))
	members := groupsPath(org) + "/" + gid + "/members"
	m1 := idOf(t, mustCreate(t, fx.A, members, map[string]any{"name": "BD-CAM-01", "ip": "10.72.120.10", "mac": "aa:bb:cc:00:00:01", "interfaceId": port, "notes": "Cổng chính"}))
	m2 := idOf(t, mustCreate(t, fx.A, members, map[string]any{"name": "Camera kho 2"}))
	m3 := idOf(t, mustCreate(t, fx.A, members, map[string]any{"name": "BD-SW01"}))

	status, dev := fx.A.Do("POST", members+"/"+m1+"/promote", map[string]any{})
	if status != http.StatusCreated || dev["hostname"] != "BD-CAM-01" || dev["type"] != "ip_camera" || dev["siteId"] != bd ||
		dev["mgmtIp"] != "10.72.120.10/24" || dev["notes"] != "Cổng chính" {
		t.Fatalf("promote: %d %v", status, dev)
	}
	devID := idOf(t, dev)
	// The switch port became a real link eth0 ↔ Gi1/0/5.
	_, links := fx.A.Do("GET", linksPath(org)+"?endId="+devID, nil)
	if ls := links["links"].([]any); len(ls) != 1 || ls[0].(map[string]any)["b"].(map[string]any)["interfaceName"] != "Gi1/0/5" ||
		ls[0].(map[string]any)["a"].(map[string]any)["interfaceName"] != "eth0" {
		t.Errorf("promote link: %v", links)
	}
	_, ips := fx.A.Do("GET", devicePath(org, devID)+"/ips", nil)
	if ip := ips["ips"].([]any)[0].(map[string]any); ip["address"] != "10.72.120.10/24" || ip["vrf"] != "OT" || ip["interfaceName"] != "eth0" {
		t.Errorf("promoted IP: %v", ip)
	}
	_, ifs := fx.A.Do("GET", devicePath(org, devID)+"/interfaces", nil)
	if i := ifs["interfaces"].([]any)[0].(map[string]any); i["mac"] != "aa:bb:cc:00:00:01" {
		t.Errorf("promoted interface: %v", i)
	}
	_, g := fx.A.Do("GET", groupsPath(org)+"/"+gid, nil)
	if g["memberCount"] != float64(2) {
		t.Errorf("member left the group: %v", g["memberCount"])
	}
	// The address is still counted once (now a device IP).
	if _, subnet := fx.A.Do("GET", subnetsPath(org)+"/"+sn, nil); subnet["usedCount"] != float64(1) {
		t.Errorf("usage after promote: %v", subnet["usedCount"])
	}
	// Names that are not hostnames need one; taken hostnames conflict; nothing changes on refusal.
	if status, _ := fx.A.Do("POST", members+"/"+m2+"/promote", map[string]any{}); status != http.StatusBadRequest {
		t.Errorf("promote a name with spaces: %d, want 400", status)
	}
	if status, _ := fx.A.Do("POST", members+"/"+m3+"/promote", map[string]any{}); status != http.StatusConflict {
		t.Errorf("promote onto a taken hostname: %d, want 409", status)
	}
	if status, d := fx.A.Do("POST", members+"/"+m2+"/promote", map[string]any{"hostname": "BD-CAM-02"}); status != http.StatusCreated || d["mgmtIp"] != "" {
		t.Errorf("promote with a hostname: %d %v", status, d)
	}
	if _, g := fx.A.Do("GET", groupsPath(org)+"/"+gid, nil); g["memberCount"] != float64(1) {
		t.Errorf("members after refusals: %v, want 1", g["memberCount"])
	}
	if auditCount(t, fx.Pool, "endpoint_member.promote", org) != 2 || auditCount(t, fx.Pool, "device.create", org) < 3 {
		t.Errorf("promote audit missing")
	}
}

func TestEndpointGroupPermissions(t *testing.T) {
	w := newPermWorld(t)
	org := w.fx.OrgA
	nmGroup := mustCreate(t, w.ue, groupsPath(org), map[string]any{"kind": "pc", "name": "PC văn phòng", "siteId": w.bd})
	if nmGroup["access"] != "edit" {
		t.Errorf("editor of NM on its group: %v", nmGroup["access"])
	}
	if status, _ := w.ue.Do("POST", groupsPath(org), map[string]any{"kind": "pc", "name": "PC", "siteId": w.hn}); status != http.StatusBadRequest {
		t.Errorf("editor of NM creates in VP's site: %d, want 400", status)
	}
	vp := idOf(t, mustCreate(t, w.fx.A, groupsPath(org), map[string]any{"kind": "ip_phone", "name": "Điện thoại", "siteId": w.hn}))
	if status, _ := w.ue.Do("GET", groupsPath(org)+"/"+vp, nil); status != http.StatusNotFound {
		t.Errorf("editor of NM reads VP's group: %d, want 404", status)
	}
	mb := idOf(t, mustCreate(t, w.fx.A, groupsPath(org)+"/"+vp+"/members", map[string]any{"name": "PHONE-01"}))
	for _, r := range []struct {
		method, path string
		body         map[string]any
	}{
		{"PATCH", groupsPath(org) + "/" + vp, map[string]any{"kind": "ip_phone", "name": "X", "siteId": w.hn, "version": 1}},
		{"POST", groupsPath(org) + "/" + vp + "/members", map[string]any{"name": "PHONE-02"}},
		{"PATCH", groupsPath(org) + "/" + vp + "/members/" + mb, map[string]any{"name": "X", "version": 1}},
		{"POST", groupsPath(org) + "/" + vp + "/members/" + mb + "/promote", map[string]any{}},
		{"DELETE", groupsPath(org) + "/" + vp + "/members/" + mb, nil},
		{"DELETE", groupsPath(org) + "/" + vp, nil},
	} {
		if status, _ := w.uv.Do(r.method, r.path, r.body); status != http.StatusForbidden {
			t.Errorf("viewer %s %s: %d, want 403", r.method, r.path, status)
		}
	}
	_, list := w.ue.Do("GET", groupsPath(org), nil)
	if n := len(list["groups"].([]any)); n != 1 {
		t.Errorf("editor of NM lists %d groups, want 1", n)
	}
}
