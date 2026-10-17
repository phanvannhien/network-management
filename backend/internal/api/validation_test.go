package api

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"github.com/google/uuid"
)

// P1-20: the validation context of a diagram and the org-wide conflicts.
func TestValidationContext(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	path := func(o uuid.UUID) string { return orgPath(o) + "/validation-context" }
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "BD"}))
	cl := idOf(t, mustCreate(t, fx.A, clustersPath(org), map[string]any{"kind": "ha_active_passive", "name": "HA", "hostname": "FW", "siteId": bd}))
	dev := func(host string, extra map[string]any) string {
		body := map[string]any{"hostname": host, "type": "firewall", "siteId": bd}
		for k, v := range extra {
			body[k] = v
		}
		return idOf(t, mustCreate(t, fx.A, devicesPath(org), body))
	}
	fw1 := dev("FW", map[string]any{"clusterId": cl, "clusterRole": "primary", "clusterMemberNo": 1, "serialNumber": "SN-1"})
	fw2 := dev("FW", map[string]any{"clusterId": cl, "clusterRole": "member", "clusterMemberNo": 2})
	sw := dev("SW01", nil)
	other := dev("SW02", nil)
	old := dev("SW-OLD", map[string]any{"lifecycle": "retired", "serialNumber": "SN-1"})
	ip := func(d, name, addr, role string) {
		i := idOf(t, mustCreate(t, fx.A, devicePath(org, d)+"/interfaces", map[string]any{"name": name, "kind": "physical"}))
		body := map[string]any{"interfaceId": i, "address": addr, "role": role}
		mustCreate(t, fx.A, devicePath(org, d)+"/ips", body)
	}
	ip(fw1, "port1", "10.0.0.1/24", "primary")
	ip(fw2, "port1", "10.0.0.1/24", "primary") // same cluster: not a conflict
	ip(sw, "Vlan1", "10.0.0.5/24", "primary")
	// Clashes the API now refuses (ADR-038) still come from older data: written straight to the database.
	legacy := func(sql string, args ...any) {
		t.Helper()
		if _, err := fx.Pool.Exec(context.Background(), sql, args...); err != nil {
			t.Fatalf("legacy data: %v", err)
		}
	}
	legacy(`UPDATE devices SET serial_number = 'sn-1' WHERE id = $1`, sw)
	otherIf := idOf(t, mustCreate(t, fx.A, devicePath(org, other)+"/interfaces", map[string]any{"name": "Vlan1", "kind": "physical"}))
	legacy(`INSERT INTO ip_addresses (organization_id, device_id, interface_id, address, role) VALUES ($1, $2, $3, '10.0.0.5/24', 'primary')`,
		org, other, otherIf) // conflict for SW01
	ip(old, "Vlan1", "10.0.0.1/24", "primary") // retired: never a conflict
	mustCreate(t, fx.A, devicePath(org, sw)+"/ips", map[string]any{"address": "203.0.113.9/32", "role": "public"})
	mustCreate(t, fx.A, devicePath(org, other)+"/ips", map[string]any{"address": "203.0.113.9/32", "role": "public"}) // NAT/public repeat: warning only
	// A cable from SW01 to a device that is not on the diagram is still returned.
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(sw, ""), "b": devEnd(other, ""), "kind": "ethernet"})

	fx.AssertCrossTenantDenied(t, "POST", path, map[string]any{"deviceIds": []string{sw}, "groupIds": []string{}})
	if _, body := fx.B.Do("POST", path(fx.OrgB), map[string]any{"deviceIds": []string{sw}, "groupIds": []string{}}); len(body["devices"].([]any)) != 0 || len(body["links"].([]any)) != 0 {
		t.Errorf("B sees A's objects: %v", body)
	}
	status, body := fx.A.Do("POST", path(org), map[string]any{"deviceIds": []string{fw1, fw2, sw}, "groupIds": []string{}})
	if status != http.StatusOK {
		t.Fatalf("context: %d %v", status, body)
	}
	if len(body["devices"].([]any)) != 3 || len(body["links"].([]any)) != 1 || len(body["ips"].([]any)) != 4 {
		t.Errorf("context sizes: devices %d links %d ips %d", len(body["devices"].([]any)), len(body["links"].([]any)), len(body["ips"].([]any)))
	}
	kinds := map[string][]string{}
	for _, c := range body["conflicts"].([]any) {
		c := c.(map[string]any)
		kinds[c["kind"].(string)] = append(kinds[c["kind"].(string)], c["deviceId"].(string)+"|"+c["other"].(string)+"|"+c["severity"].(string))
	}
	want := map[string]bool{sw + "|SW02|error": true, sw + "|SW02|warning": true}
	if len(kinds["ip"]) != 2 || !want[kinds["ip"][0]] || !want[kinds["ip"][1]] || kinds["ip"][0] == kinds["ip"][1] {
		t.Errorf("ip conflicts: %v (cluster members and retired devices never count; a public repeat is a warning)", kinds["ip"])
	}
	if len(kinds["hostname"]) != 0 {
		t.Errorf("hostname conflicts within a cluster: %v", kinds["hostname"])
	}
	// A port only an unsaved cable uses comes back when asked for; a port of a device not sent stays out.
	free := idOf(t, mustCreate(t, fx.A, devicePath(org, sw)+"/interfaces", map[string]any{"name": "Gi9", "kind": "physical"}))
	otherPort := idOf(t, mustCreate(t, fx.A, devicePath(org, other)+"/interfaces", map[string]any{"name": "Gi9", "kind": "physical"}))
	_, withPorts := fx.A.Do("POST", path(org), map[string]any{"deviceIds": []string{sw}, "groupIds": []string{}, "interfaceIds": []string{free, otherPort}})
	names := []string{}
	for _, i := range withPorts["interfaces"].([]any) {
		names = append(names, i.(map[string]any)["id"].(string))
	}
	if !slices.Contains(names, free) || slices.Contains(names, otherPort) {
		t.Errorf("extra ports: %v", names)
	}
	if len(kinds["serial"]) != 2 {
		t.Errorf("serial conflicts (case-insensitive, both sides on the diagram, retired left out): %v", kinds["serial"])
	}
}
