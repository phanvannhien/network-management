package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// ADR-033: before deleting devices from the inventory the editor lists their links (all of them), the diagrams
// showing them, clusters losing a member and the IPs released.
func TestDeviceDeleteImpact(t *testing.T) {
	fx := newOrgFixture(t)
	impact := func(o uuid.UUID) string { return devicesPath(o) + "/delete-impact" }
	org := fx.OrgA
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "BD"}))
	dev := func(host string, extra map[string]any) string {
		body := map[string]any{"hostname": host, "type": "l2_switch", "siteId": bd}
		for k, v := range extra {
			body[k] = v
		}
		return idOf(t, mustCreate(t, fx.A, devicesPath(org), body))
	}
	cl := idOf(t, mustCreate(t, fx.A, clustersPath(org), map[string]any{"kind": "stack", "name": "ST1", "hostname": "ST1", "siteId": bd}))
	sw1, sw2, fw := dev("SW01", map[string]any{"clusterId": cl}), dev("SW02", map[string]any{"clusterId": cl}), dev("FW01", nil)
	p := idOf(t, mustCreate(t, fx.A, devicePath(org, sw1)+"/interfaces", map[string]any{"name": "Vlan10", "kind": "svi"}))
	mustCreate(t, fx.A, devicePath(org, sw1)+"/ips", map[string]any{"interfaceId": p, "address": "10.0.0.2/24", "role": "primary"})
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(sw1, ""), "b": devEnd(fw, ""), "kind": "ethernet"})
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(sw1, ""), "b": devEnd(sw2, ""), "kind": "stack"})
	mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(sw2, ""), "b": devEnd(fw, ""), "kind": "ethernet"})
	dg := idOf(t, mustCreate(t, fx.A, diagramsPath(org), map[string]any{"name": "LAN", "layer": "physical"})["diagram"].(map[string]any))
	if status, body := fx.A.Do("POST", diagramsPath(org)+"/"+dg+"/save", map[string]any{"version": 1, "view": view([]map[string]any{node("n1", "device", sw1, 0)})}); status != http.StatusOK {
		t.Fatalf("save: %d %v", status, body)
	}

	fx.AssertCrossTenantDenied(t, "POST", impact, map[string]any{"ids": []string{sw1}})
	// Another organization's device id reveals nothing.
	if _, body := fx.B.Do("POST", impact(fx.OrgB), map[string]any{"ids": []string{sw1}}); len(body["devices"].([]any)) != 0 || len(body["links"].([]any)) != 0 || len(body["diagrams"].([]any)) != 0 {
		t.Errorf("B sees A's device: %v", body)
	}
	status, body := fx.A.Do("POST", impact(org), map[string]any{"ids": []string{sw1, uuid.NewString()}})
	if status != http.StatusOK {
		t.Fatalf("impact: %d %v", status, body)
	}
	devs := body["devices"].([]any)
	if len(devs) != 1 {
		t.Fatalf("devices: %v", devs)
	}
	d := devs[0].(map[string]any)
	if d["hostname"] != "SW01" || d["clusterName"] != "ST1" || d["clusterMembersLeft"] != float64(1) || d["ipCount"] != float64(1) || d["siteCode"] != "ORG-BD01" {
		t.Errorf("device impact: %v", d)
	}
	if n := len(body["links"].([]any)); n != 2 {
		t.Errorf("links of SW01: %d, want 2 (not SW02–FW01)", n)
	}
	dgs := body["diagrams"].([]any)
	if len(dgs) != 1 || dgs[0].(map[string]any)["name"] != "LAN" || len(dgs[0].(map[string]any)["deviceIds"].([]any)) != 1 {
		t.Errorf("diagrams: %v", dgs)
	}
	if status, _ := fx.A.Do("POST", impact(org), map[string]any{"ids": []string{}}); status != http.StatusBadRequest {
		t.Errorf("empty ids: %d, want 400", status)
	}
}
