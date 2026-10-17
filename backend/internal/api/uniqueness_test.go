package api

import (
	"net/http"
	"strings"
	"testing"
)

// ADR-038: a serial is one box and an address one owner per VRF — refused on write, except the copies that are right
// by design (same cluster, NAT / public, VRRP / HSRP VIPs, kit not in use).
func TestSerialAndAddressUniqueness(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	cat := mustCategory(t, fx.A, org, "FOOD")
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HN01", "name": "HN", "categoryId": cat}))
	dev := func(host string, extra map[string]any) (int, map[string]any) {
		body := map[string]any{"hostname": host, "type": "router", "siteId": site}
		for k, v := range extra {
			body[k] = v
		}
		return fx.A.Do("POST", devicesPath(org), body)
	}
	id := func(host string, extra map[string]any) string {
		t.Helper()
		status, body := dev(host, extra)
		if status != http.StatusCreated {
			t.Fatalf("create %s: %d %v", host, status, body)
		}
		return idOf(t, body)
	}

	// Serial numbers.
	r1 := id("R1", map[string]any{"serialNumber": "FDO2231M1AB"})
	if status, body := dev("R2", map[string]any{"serialNumber": " fdo2231m1ab "}); status != http.StatusBadRequest || !strings.Contains(body["message"].(string), "R1") {
		t.Errorf("same serial: %d %v", status, body)
	}
	id("R3", map[string]any{"serialNumber": "N/A"})
	id("R4", map[string]any{"serialNumber": "n/a"})
	id("OLD", map[string]any{"serialNumber": "FTX1", "lifecycle": "retired"})
	id("NEW", map[string]any{"serialNumber": "FTX1"}) // the retired record does not block
	if status, _ := dev("OLD2", map[string]any{"serialNumber": "FDO2231M1AB", "lifecycle": "retired"}); status != http.StatusCreated {
		t.Errorf("a retired record may keep a serial in use: %d", status)
	}

	// Addresses.
	port := func(d, name string) string {
		return idOf(t, mustCreate(t, fx.A, devicePath(org, d)+"/interfaces", map[string]any{"name": name, "kind": "svi"}))
	}
	addIP := func(d, iface, addr, role, vrf string) (int, map[string]any) {
		return fx.A.Do("POST", devicePath(org, d)+"/ips", map[string]any{"interfaceId": iface, "address": addr, "role": role, "vrf": vrf})
	}
	r2 := id("R2", nil)
	i1, i2 := port(r1, "Vlan10"), port(r2, "Vlan10")
	if status, _ := addIP(r1, i1, "10.0.10.2/24", "primary", ""); status != http.StatusCreated {
		t.Fatalf("first address: %d", status)
	}
	if status, body := addIP(r2, i2, "10.0.10.2/24", "primary", ""); status != http.StatusConflict || !strings.Contains(body["message"].(string), "R1 (Vlan10)") {
		t.Errorf("same address, same VRF: %d %v", status, body)
	}
	if status, _ := addIP(r2, i2, "10.0.10.2/24", "primary", "CUST-B"); status != http.StatusCreated {
		t.Errorf("same address in another VRF: %d", status)
	}
	// VRRP / HSRP: both copies VIP.
	if status, _ := addIP(r1, i1, "10.0.10.1/24", "vip", ""); status != http.StatusCreated {
		t.Errorf("VIP on R1: %d", status)
	}
	if status, body := addIP(r2, i2, "10.0.10.1/24", "secondary", ""); status != http.StatusConflict || !strings.Contains(body["message"].(string), "VIP") {
		t.Errorf("VIP copied as a plain address: %d %v", status, body)
	}
	if status, _ := addIP(r2, i2, "10.0.10.1/24", "vip", ""); status != http.StatusCreated {
		t.Errorf("VIP on R2: %d", status)
	}
	// NAT / public copies are shared (PAT).
	if status, _ := fx.A.Do("POST", devicePath(org, r2)+"/ips", map[string]any{"address": "10.0.10.2/32", "role": "nat"}); status != http.StatusCreated {
		t.Errorf("NAT copy: %d", status)
	}
	// Kit not in use (a replacement staged with the same config) is warned elsewhere, not refused.
	spare := id("SPARE", map[string]any{"lifecycle": "spare"})
	if status, _ := addIP(spare, port(spare, "Vlan10"), "10.0.10.2/24", "primary", ""); status != http.StatusCreated {
		t.Errorf("spare unit with the same address: %d", status)
	}
	// A cluster and its members are one owner; anybody else is refused.
	cl := idOf(t, mustCreate(t, fx.A, clustersPath(org), map[string]any{"kind": "ha_active_passive", "name": "HA", "mgmtIp": "10.0.20.1/24", "siteId": site}))
	fw := id("FW1", map[string]any{"type": "firewall", "clusterId": cl, "clusterMemberNo": 1})
	if status, _ := addIP(fw, port(fw, "mgmt"), "10.0.20.1/24", "primary", ""); status != http.StatusCreated {
		t.Errorf("member with the cluster IP: %d", status)
	}
	if status, _ := addIP(r1, i1, "10.0.20.1/24", "secondary", ""); status != http.StatusConflict {
		t.Errorf("stranger with the cluster IP: %d", status)
	}
	if status, _ := fx.A.Do("POST", clustersPath(org), map[string]any{"kind": "ha_active_passive", "name": "HA2", "mgmtIp": "10.0.10.2/24", "siteId": site}); status != http.StatusConflict {
		t.Errorf("cluster IP already used by a device: %d", status)
	}
	// Endpoint group members too.
	grp := idOf(t, mustCreate(t, fx.A, groupsPath(org), map[string]any{"siteId": site, "kind": "ip_camera", "name": "Camera"}))
	if status, _ := fx.A.Do("POST", groupsPath(org)+"/"+grp+"/members", map[string]any{"name": "CAM1", "ip": "10.0.10.2"}); status != http.StatusConflict {
		t.Errorf("member with a device address: %d", status)
	}
	if status, _ := fx.A.Do("POST", groupsPath(org)+"/"+grp+"/members", map[string]any{"name": "CAM2", "ip": "10.0.10.50"}); status != http.StatusCreated {
		t.Errorf("free member address: %d", status)
	}
	_ = r2
}
