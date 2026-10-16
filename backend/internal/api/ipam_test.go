package api

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func vlansPath(org uuid.UUID) string   { return orgPath(org) + "/vlans" }
func subnetsPath(org uuid.UUID) string { return orgPath(org) + "/subnets" }
func lookupPath(org uuid.UUID, ip string) string {
	return orgPath(org) + "/ipam/lookup?ip=" + url.QueryEscape(ip)
}

// addDeviceIP creates a device with one SVI holding the address.
func addDeviceIP(t *testing.T, c *tenanttest.Client, org uuid.UUID, site, hostname, address, vrf string) string {
	t.Helper()
	dev := idOf(t, mustCreate(t, c, devicesPath(org), map[string]any{"hostname": hostname, "type": "l3_switch", "siteId": site}))
	ifc := idOf(t, mustCreate(t, c, devicePath(org, dev)+"/interfaces", map[string]any{"name": "Vlan10", "kind": "svi"}))
	mustCreate(t, c, devicePath(org, dev)+"/ips", map[string]any{"interfaceId": ifc, "address": address, "role": "primary", "vrf": vrf})
	return dev
}

// Cross-tenant isolation for every IPAM endpoint, plus referencing another org's site or VLAN.
func TestIpamEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	_, unitB := mustPartnerUnit(t, fx.B, fx.OrgB, "FOOD")
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "FOOD-HN01", "name": "B", "businessUnitId": unitB}))
	vlanB := idOf(t, mustCreate(t, fx.B, vlansPath(fx.OrgB), map[string]any{"vid": 10, "name": "MGMT", "siteId": siteB}))
	snB := idOf(t, mustCreate(t, fx.B, subnetsPath(fx.OrgB), map[string]any{"cidr": "10.0.0.0/24", "siteId": siteB, "vlanId": vlanB}))
	rgB := idOf(t, mustCreate(t, fx.B, subnetsPath(fx.OrgB)+"/"+snB+"/ranges", map[string]any{"startIp": "10.0.0.100", "endIp": "10.0.0.200", "kind": "dhcp"}))
	sn := func(o uuid.UUID) string { return subnetsPath(o) + "/" + snB }
	fx.AssertCrossTenantDenied(t, "GET", vlansPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", vlansPath, map[string]any{"vid": 20, "name": "CAM"})
	fx.AssertCrossTenantDenied(t, "GET", subnetsPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", subnetsPath, map[string]any{"cidr": "10.1.0.0/24"})
	fx.AssertCrossTenantDenied(t, "GET", sn, nil)
	fx.AssertCrossTenantDenied(t, "GET", func(o uuid.UUID) string { return sn(o) + "/next-free" }, nil)
	fx.AssertCrossTenantDenied(t, "GET", func(o uuid.UUID) string { return lookupPath(o, "10.0.0.5") }, nil)
	for _, org := range []uuid.UUID{fx.OrgB, fx.OrgA} {
		for _, r := range []struct {
			method, path string
			body         map[string]any
		}{
			{"PATCH", vlansPath(org) + "/" + vlanB, map[string]any{"vid": 99, "name": "HACK", "siteId": siteB, "version": 1}},
			{"DELETE", vlansPath(org) + "/" + vlanB, nil},
			{"PATCH", sn(org), map[string]any{"cidr": "10.0.0.0/16", "siteId": siteB, "version": 1}},
			{"DELETE", sn(org), nil},
			{"POST", sn(org) + "/ranges", map[string]any{"startIp": "10.0.0.10", "endIp": "10.0.0.20", "kind": "reserved"}},
			{"PATCH", sn(org) + "/ranges/" + rgB, map[string]any{"startIp": "10.0.0.10", "endIp": "10.0.0.20", "kind": "reserved", "version": 1}},
			{"DELETE", sn(org) + "/ranges/" + rgB, nil},
		} {
			if status, _ := fx.A.Do(r.method, r.path, r.body); status != http.StatusNotFound {
				t.Errorf("A %s %s: %d, want 404", r.method, r.path, status)
			}
		}
	}
	// Org A cannot place objects in B's site or attach B's VLAN.
	if status, _ := fx.A.Do("POST", vlansPath(fx.OrgA), map[string]any{"vid": 30, "name": "X", "siteId": siteB}); status != http.StatusBadRequest {
		t.Errorf("VLAN in another org's site: %d, want 400", status)
	}
	if status, _ := fx.A.Do("POST", subnetsPath(fx.OrgA), map[string]any{"cidr": "10.9.0.0/24", "vlanId": vlanB}); status != http.StatusBadRequest {
		t.Errorf("subnet with another org's VLAN: %d, want 400", status)
	}
	// A's lookup of B's address finds nothing of B.
	addDeviceIP(t, fx.B, fx.OrgB, siteB, "B-SW1", "10.0.0.5/24", "")
	if _, got := fx.A.Do("GET", lookupPath(fx.OrgA, "10.0.0.5"), nil); len(got["subnets"].([]any)) != 0 || len(got["assignments"].([]any)) != 0 || got["hiddenCount"] != float64(0) {
		t.Errorf("A looks up B's address: %v", got)
	}
	_, got := fx.B.Do("GET", sn(fx.OrgB), nil)
	if got["cidr"] != "10.0.0.0/24" || len(got["ranges"].([]any)) != 1 || got["usedCount"] != float64(1) {
		t.Errorf("B's subnet changed: %v", got)
	}
	_, v := fx.B.Do("GET", vlansPath(fx.OrgB), nil)
	for _, x := range v["vlans"].([]any) {
		if vl := x.(map[string]any); vl["id"] == vlanB && (vl["name"] != "MGMT" || vl["vid"] != float64(10)) {
			t.Errorf("B's VLAN changed: %v", vl)
		}
	}
}

func TestVlanRules(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	_, nm := mustPartnerUnit(t, fx.A, org, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "AGRI-BD01", "name": "BD", "businessUnitId": nm}))
	hn := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "AGRI-HN01", "name": "HN", "businessUnitId": nm}))
	for name, body := range map[string]map[string]any{
		"vid 0":     {"vid": 0, "name": "X"},
		"vid 4095":  {"vid": 4095, "name": "X"},
		"no name":   {"vid": 10, "name": " "},
		"bad color": {"vid": 10, "name": "X", "color": "red"},
	} {
		if status, _ := fx.A.Do("POST", vlansPath(org), body); status != http.StatusBadRequest {
			t.Errorf("VLAN %s: %d, want 400", name, status)
		}
	}
	v := mustCreate(t, fx.A, vlansPath(org), map[string]any{"vid": 10, "name": "MGMT", "color": "#0EA5E9", "siteId": bd})
	if v["color"] != "#0ea5e9" || v["siteCode"] != "AGRI-BD01" || v["access"] != "admin" {
		t.Errorf("VLAN stored as %v", v)
	}
	if status, _ := fx.A.Do("POST", vlansPath(org), map[string]any{"vid": 10, "name": "DUP", "siteId": bd}); status != http.StatusConflict {
		t.Errorf("duplicate VLAN in one site: %d, want 409", status)
	}
	mustCreate(t, fx.A, vlansPath(org), map[string]any{"vid": 10, "name": "MGMT", "siteId": hn})
	global := idOf(t, mustCreate(t, fx.A, vlansPath(org), map[string]any{"vid": 10, "name": "MGMT-ALL"}))
	if status, _ := fx.A.Do("POST", vlansPath(org), map[string]any{"vid": 10, "name": "DUP"}); status != http.StatusConflict {
		t.Errorf("duplicate org-wide VLAN: %d, want 409", status)
	}
	// The site filter shows the site's VLANs and the organization-wide ones.
	_, list := fx.A.Do("GET", vlansPath(org)+"?siteId="+bd, nil)
	if n := len(list["vlans"].([]any)); n != 2 {
		t.Errorf("VLANs for BD: %d, want 2", n)
	}
	// An org-wide VLAN used by subnets of two sites cannot move into one of them.
	mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.72.114.0/24", "siteId": bd, "vlanId": global})
	mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.72.115.0/24", "siteId": hn, "vlanId": global})
	if status, _ := fx.A.Do("PATCH", vlansPath(org)+"/"+global, map[string]any{"vid": 10, "name": "MGMT-ALL", "siteId": bd, "version": 1}); status != http.StatusBadRequest {
		t.Errorf("VLAN moved away from its subnets: %d, want 400", status)
	}
	if status, _ := fx.A.Do("PATCH", vlansPath(org)+"/"+global, map[string]any{"vid": 11, "name": "MGMT-ALL", "version": 7}); status != http.StatusConflict {
		t.Errorf("stale VLAN version: %d, want 409", status)
	}
	if status, upd := fx.A.Do("PATCH", vlansPath(org)+"/"+global, map[string]any{"vid": 11, "name": "MGMT-ALL", "version": 1}); status != http.StatusOK || upd["subnetCount"] != float64(2) {
		t.Errorf("VLAN update: %d %v", status, upd)
	}
	// Deleting a VLAN keeps its subnets (vlan cleared).
	if status, _ := fx.A.Do("DELETE", vlansPath(org)+"/"+global, nil); status != http.StatusNoContent {
		t.Errorf("delete VLAN: %d", status)
	}
	if _, subs := fx.A.Do("GET", subnetsPath(org), nil); len(subs["subnets"].([]any)) != 2 || subs["subnets"].([]any)[0].(map[string]any)["vlanId"] != nil {
		t.Errorf("subnets after VLAN delete: %v", subs)
	}
	for _, a := range []string{"vlan.create", "vlan.update", "vlan.delete"} {
		if auditCount(t, fx.Pool, a, org) == 0 {
			t.Errorf("no %s audit", a)
		}
	}
}

func TestSubnetRules(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	_, nm := mustPartnerUnit(t, fx.A, org, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "AGRI-BD01", "name": "BD", "businessUnitId": nm}))
	hn := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "AGRI-HN01", "name": "HN", "businessUnitId": nm}))
	vlanHN := idOf(t, mustCreate(t, fx.A, vlansPath(org), map[string]any{"vid": 10, "name": "MGMT", "siteId": hn}))
	for name, body := range map[string]map[string]any{
		"not CIDR":          {"cidr": "10.72.114.0"},
		"single address":    {"cidr": "10.72.114.5/32"},
		"gateway outside":   {"cidr": "10.72.114.0/24", "gateway": "10.72.115.1"},
		"gateway = network": {"cidr": "10.72.114.0/24", "gateway": "10.72.114.0"},
		"gateway broadcast": {"cidr": "10.72.114.0/24", "gateway": "10.72.114.255"},
		"gateway not IP":    {"cidr": "10.72.114.0/24", "gateway": "gw"},
		"VLAN of HN in BD":  {"cidr": "10.72.114.0/24", "siteId": bd, "vlanId": vlanHN},
		"unknown site":      {"cidr": "10.72.114.0/24", "siteId": uuid.NewString()},
	} {
		if status, _ := fx.A.Do("POST", subnetsPath(org), body); status != http.StatusBadRequest {
			t.Errorf("subnet %s: %d, want 400", name, status)
		}
	}
	// A host address is normalised to its network.
	sn := mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.72.114.7/24", "gateway": "10.72.114.1", "siteId": bd})
	if sn["cidr"] != "10.72.114.0/24" || sn["size"] != float64(254) || sn["gateway"] != "10.72.114.1" || sn["siteCode"] != "AGRI-BD01" {
		t.Errorf("subnet stored as %v", sn)
	}
	if status, _ := fx.A.Do("POST", subnetsPath(org), map[string]any{"cidr": "10.72.114.0/24"}); status != http.StatusConflict {
		t.Errorf("duplicate subnet in VRF: %d, want 409", status)
	}
	mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.72.114.0/24", "vrf": "CUST-B"})
	nested := mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.72.114.0/26"})
	p2p := mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.255.0.0/31", "gateway": "10.255.0.0"})
	v6 := mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "2001:db8::/64", "gateway": "2001:db8::1"})
	if nested["size"] != float64(62) || p2p["size"] != float64(2) || v6["size"].(float64) < 1e18 {
		t.Errorf("sizes: /26 %v /31 %v /64 %v", nested["size"], p2p["size"], v6["size"])
	}
	_, list := fx.A.Do("GET", subnetsPath(org)+"?q=10.72.114", nil)
	if n := len(list["subnets"].([]any)); n != 3 {
		t.Errorf("search 10.72.114: %d subnets, want 3", n)
	}
	_, list = fx.A.Do("GET", subnetsPath(org)+"?siteId="+bd, nil)
	if n := len(list["subnets"].([]any)); n != 1 {
		t.Errorf("subnets of BD: %d, want 1", n)
	}
	id := idOf(t, sn)
	if status, _ := fx.A.Do("PATCH", subnetsPath(org)+"/"+id, map[string]any{"cidr": "10.72.114.0/23", "siteId": hn, "vlanId": vlanHN, "version": 1}); status != http.StatusOK {
		t.Errorf("move subnet to HN with HN's VLAN: %d", status)
	}
	if status, _ := fx.A.Do("PATCH", subnetsPath(org)+"/"+id, map[string]any{"cidr": "10.72.114.0/23", "version": 1}); status != http.StatusConflict {
		t.Errorf("stale subnet: %d, want 409", status)
	}
	if status, _ := fx.A.Do("DELETE", subnetsPath(org)+"/"+id, nil); status != http.StatusNoContent {
		t.Errorf("delete subnet: %d", status)
	}
	if status, _ := fx.A.Do("GET", subnetsPath(org)+"/"+id, nil); status != http.StatusNotFound {
		t.Errorf("deleted subnet: %d, want 404", status)
	}
	for _, a := range []string{"subnet.create", "subnet.update", "subnet.delete"} {
		if auditCount(t, fx.Pool, a, org) == 0 {
			t.Errorf("no %s audit", a)
		}
	}
}

func TestSubnetUsageRangesNextFreeAndLookup(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	_, nm := mustPartnerUnit(t, fx.A, org, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "AGRI-BD01", "name": "BD", "businessUnitId": nm}))
	sn := idOf(t, mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.72.114.0/24", "gateway": "10.72.114.1", "siteId": bd}))
	path := subnetsPath(org) + "/" + sn
	addDeviceIP(t, fx.A, org, bd, "BD-SW1", "10.72.114.2/24", "")
	addDeviceIP(t, fx.A, org, bd, "BD-SW2", "10.72.114.3/24", "")
	addDeviceIP(t, fx.A, org, bd, "CUST-RT", "10.72.114.10/24", "CUST-B") // other VRF: not counted
	ranges := path + "/ranges"
	dhcp := mustCreate(t, fx.A, ranges, map[string]any{"startIp": "10.72.114.100", "endIp": "10.72.114.200", "kind": "dhcp", "purpose": "Wi-Fi khách"})
	if dhcp["size"] != float64(101) {
		t.Errorf("DHCP range size %v, want 101", dhcp["size"])
	}
	mustCreate(t, fx.A, ranges, map[string]any{"startIp": "10.72.114.4", "endIp": "10.72.114.9", "kind": "reserved"})
	mustCreate(t, fx.A, ranges, map[string]any{"startIp": "10.72.114.20", "endIp": "10.72.114.29", "kind": "static"})
	for name, c := range map[string]struct {
		body map[string]any
		want int
	}{
		"overlap":         {map[string]any{"startIp": "10.72.114.150", "endIp": "10.72.114.210", "kind": "reserved"}, http.StatusConflict},
		"outside subnet":  {map[string]any{"startIp": "10.72.115.1", "endIp": "10.72.115.9", "kind": "reserved"}, http.StatusBadRequest},
		"broadcast":       {map[string]any{"startIp": "10.72.114.250", "endIp": "10.72.114.255", "kind": "reserved"}, http.StatusBadRequest},
		"start after end": {map[string]any{"startIp": "10.72.114.240", "endIp": "10.72.114.230", "kind": "reserved"}, http.StatusBadRequest},
		"unknown kind":    {map[string]any{"startIp": "10.72.114.230", "endIp": "10.72.114.240", "kind": "pool"}, http.StatusBadRequest},
		"unknown subnet":  {map[string]any{"startIp": "10.72.114.230", "endIp": "10.72.114.240", "kind": "dhcp"}, http.StatusNotFound},
	} {
		p := ranges
		if name == "unknown subnet" {
			p = subnetsPath(org) + "/" + uuid.NewString() + "/ranges"
		}
		if status, body := fx.A.Do("POST", p, c.body); status != c.want {
			t.Errorf("range %s: %d %v, want %d", name, status, body, c.want)
		}
	}
	// Next free skips the gateway, used addresses and DHCP/reserved ranges; static ranges are where it hands out.
	_, next := fx.A.Do("GET", path+"/next-free", nil)
	if next["address"] != "10.72.114.10/24" || next["host"] != "10.72.114.10" {
		t.Errorf("next free: %v, want 10.72.114.10/24 (other-VRF address is free here)", next)
	}
	// A cluster's management IP (an HA pair's shared address) is in use although no interface carries it.
	cl := idOf(t, mustCreate(t, fx.A, clustersPath(org), map[string]any{"kind": "ha_active_passive", "name": "BD-FW-HA", "mgmtIp": "10.72.114.10/24", "siteId": bd}))
	if _, next := fx.A.Do("GET", path+"/next-free", nil); next["host"] != "10.72.114.11" {
		t.Errorf("next free after the cluster IP: %v, want 10.72.114.11", next)
	}
	_, byCluster := fx.A.Do("GET", lookupPath(org, "10.72.114.10"), nil)
	if as := byCluster["assignments"].([]any); len(as) != 2 {
		t.Errorf("lookup of the cluster IP: %v", byCluster)
	} else {
		var got map[string]any
		for _, a := range as {
			if a.(map[string]any)["clusterId"] != nil {
				got = a.(map[string]any)
			}
		}
		if got == nil || got["clusterId"] != cl || got["deviceId"] != nil || got["hostname"] != "BD-FW-HA" {
			t.Errorf("cluster assignment: %v", as)
		}
	}
	addDeviceIP(t, fx.A, org, bd, "BD-AP1", "10.72.114.150/24", "")
	_, detail := fx.A.Do("GET", path, nil)
	if detail["usedCount"] != float64(4) || detail["rangeCount"] != float64(3) || len(detail["ips"].([]any)) != 4 || detail["hiddenCount"] != float64(0) {
		t.Errorf("subnet detail: used %v ranges %v ips %v hidden %v", detail["usedCount"], detail["rangeCount"], detail["ips"], detail["hiddenCount"])
	}
	for _, r := range detail["ranges"].([]any) {
		rg := r.(map[string]any)
		if rg["kind"] == "dhcp" && rg["usedCount"] != float64(1) {
			t.Errorf("DHCP range used %v, want 1", rg["usedCount"])
		}
	}
	// Ranges must still fit when the subnet shrinks.
	if status, _ := fx.A.Do("PATCH", path, map[string]any{"cidr": "10.72.114.0/25", "gateway": "10.72.114.1", "siteId": bd, "version": 1}); status != http.StatusBadRequest {
		t.Errorf("shrink below a range: %d, want 400", status)
	}
	dhcpID := idOf(t, dhcp)
	if status, _ := fx.A.Do("PATCH", ranges+"/"+dhcpID, map[string]any{"startIp": "10.72.114.5", "endIp": "10.72.114.120", "kind": "dhcp", "version": 1}); status != http.StatusConflict {
		t.Errorf("range update overlapping: %d, want 409", status)
	}
	if status, upd := fx.A.Do("PATCH", ranges+"/"+dhcpID, map[string]any{"startIp": "10.72.114.100", "endIp": "10.72.114.120", "kind": "dhcp", "version": 1}); status != http.StatusOK || upd["size"] != float64(21) || upd["usedCount"] != float64(0) {
		t.Errorf("range update: %d %v", status, upd)
	}
	if status, _ := fx.A.Do("PATCH", ranges+"/"+dhcpID, map[string]any{"startIp": "10.72.114.100", "endIp": "10.72.114.110", "kind": "dhcp", "version": 1}); status != http.StatusConflict {
		t.Errorf("stale range: %d, want 409", status)
	}
	if status, _ := fx.A.Do("DELETE", ranges+"/"+dhcpID, nil); status != http.StatusNoContent {
		t.Errorf("delete range: %d", status)
	}
	if status, _ := fx.A.Do("DELETE", ranges+"/"+dhcpID, nil); status != http.StatusNotFound {
		t.Errorf("delete range twice: %d, want 404", status)
	}
	for _, a := range []string{"ip_range.create", "ip_range.update", "ip_range.delete"} {
		if auditCount(t, fx.Pool, a, org) == 0 {
			t.Errorf("no %s audit", a)
		}
	}
	// A full /30 has no free address.
	p2p := idOf(t, mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.255.0.0/30", "gateway": "10.255.0.1"}))
	addDeviceIP(t, fx.A, org, bd, "BD-RT1", "10.255.0.2/30", "")
	if _, full := fx.A.Do("GET", subnetsPath(org)+"/"+p2p+"/next-free", nil); full["address"] != nil {
		t.Errorf("next free of a full /30: %v", full)
	}
	// Lookup accepts an address or CIDR and lists every containing subnet and assignment.
	mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.72.0.0/16"})
	_, found := fx.A.Do("GET", lookupPath(org, "10.72.114.2/24"), nil)
	if found["ip"] != "10.72.114.2" || len(found["subnets"].([]any)) != 2 || len(found["assignments"].([]any)) != 1 ||
		found["assignments"].([]any)[0].(map[string]any)["hostname"] != "BD-SW1" {
		t.Errorf("lookup: %v", found)
	}
	if status, _ := fx.A.Do("GET", lookupPath(org, "not-an-ip"), nil); status != http.StatusBadRequest {
		t.Errorf("lookup of garbage: %d, want 400", status)
	}
}

func TestIpamPermissions(t *testing.T) {
	w := newRoleWorld(t)
	org := w.fx.OrgA
	if status, _ := w.editor.Do("POST", vlansPath(org), map[string]any{"vid": 10, "name": "MGMT", "siteId": w.site}); status != http.StatusCreated {
		t.Errorf("editor creates a VLAN: %d", status)
	}
	if status, _ := w.editor.Do("POST", subnetsPath(org), map[string]any{"cidr": "10.0.0.0/8"}); status != http.StatusCreated {
		t.Errorf("editor creates an org-wide subnet: %d", status)
	}
	sn := idOf(t, mustCreate(t, w.fx.A, subnetsPath(org), map[string]any{"cidr": "10.72.120.0/24", "siteId": w.other}))
	addDeviceIP(t, w.fx.A, org, w.other, "HN-SW1", "10.72.120.2/24", "")
	if status, d := w.viewer.Do("GET", subnetsPath(org)+"/"+sn, nil); status != http.StatusOK || d["access"] != "view" || len(d["ips"].([]any)) != 1 || d["hiddenCount"] != float64(0) {
		t.Errorf("viewer reads a subnet: %d %v", status, d)
	}
	for _, r := range []struct {
		method, path string
		body         map[string]any
	}{
		{"PATCH", subnetsPath(org) + "/" + sn, map[string]any{"cidr": "10.72.120.0/24", "siteId": w.other, "version": 1}},
		{"DELETE", subnetsPath(org) + "/" + sn, nil},
		{"POST", subnetsPath(org) + "/" + sn + "/ranges", map[string]any{"startIp": "10.72.120.100", "endIp": "10.72.120.200", "kind": "dhcp"}},
		{"POST", vlansPath(org), map[string]any{"vid": 20, "name": "CAM"}},
	} {
		if status, _ := w.viewer.Do(r.method, r.path, r.body); status != http.StatusForbidden {
			t.Errorf("viewer %s %s: %d, want 403", r.method, r.path, status)
		}
	}
	if _, found := w.viewer.Do("GET", lookupPath(org, "10.72.120.2"), nil); len(found["assignments"].([]any)) != 1 {
		t.Errorf("viewer lookup: %v", found)
	}
}
