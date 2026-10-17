package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// P1-21: device import — dry run, clusters from a shared IP, management IPs, upsert by hostname, tenant isolation.
func TestDeviceImport(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	path := func(o uuid.UUID) string { return orgPath(o) + "/device-imports" }
	idc := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "IDC01", "name": "FPT IDC HCM"}))
	hn := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HN01", "name": "HaNoi"}))
	mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.136.4.0/24", "siteId": idc})
	row := func(n int, host, typ, site string, extra map[string]any) map[string]any {
		dev := map[string]any{"hostname": host, "type": typ, "siteId": site}
		r := map[string]any{"row": n, "device": dev}
		for k, v := range extra {
			if k == "mgmtIp" || k == "clusterKey" || k == "mgmtInterface" {
				r[k] = v
			} else {
				dev[k] = v
			}
		}
		return r
	}
	body := func(dry bool, match string, rows ...map[string]any) map[string]any {
		return map[string]any{
			"dryRun": dry, "matchBy": match, "rows": rows,
			"clusters": []map[string]any{{"key": "c1", "kind": "ha_active_passive", "name": "CJIDC-HA", "hostname": "VPN_CJIDC", "mgmtIp": "10.136.4.101", "siteId": idc}},
		}
	}
	rows := []map[string]any{
		row(2, "VPN_CJIDC", "firewall", idc, map[string]any{"clusterKey": "c1", "clusterRole": "primary", "clusterMemberNo": 1, "serialNumber": "FGT1", "mgmtIp": "10.136.4.101"}),
		row(3, "CJIDC_HA_Slaver", "firewall", idc, map[string]any{"clusterKey": "c1", "clusterRole": "secondary", "clusterMemberNo": 2, "serialNumber": "FGT2"}),
		row(4, "CSB220_HN", "l2_switch", hn, map[string]any{"mgmtIp": "10.136.41.2", "notes": "from excel"}),
		row(5, "csb220_hn", "l2_switch", hn, nil), // same hostname in the file: refused
	}

	fx.AssertCrossTenantDenied(t, "POST", path, body(true, "none", rows[2]))
	// B cannot place a device in A's site.
	if _, got := fx.B.Do("POST", path(fx.OrgB), map[string]any{"dryRun": false, "matchBy": "none", "clusters": []any{}, "rows": []any{rows[2]}}); got["results"] == nil ||
		got["results"].([]any)[0].(map[string]any)["action"] != "error" {
		t.Errorf("B imported into A's site: %v", got)
	}

	// Dry run: results per row, nothing written.
	status, got := fx.A.Do("POST", path(org), body(true, "none", rows...))
	if status != http.StatusOK {
		t.Fatalf("dry run: %d %v", status, got)
	}
	actions := func(got map[string]any) []string {
		out := []string{}
		for _, r := range got["results"].([]any) {
			out = append(out, r.(map[string]any)["action"].(string))
		}
		return out
	}
	if a := actions(got); len(a) != 4 || a[0] != "create" || a[1] != "create" || a[2] != "create" || a[3] != "error" {
		t.Errorf("dry run actions: %v %v", a, got)
	}
	if _, list := fx.A.Do("GET", devicesPath(org), nil); len(list["devices"].([]any)) != 0 {
		t.Errorf("dry run wrote devices")
	}
	if _, cl := fx.A.Do("GET", clustersPath(org), nil); len(cl["clusters"].([]any)) != 0 {
		t.Errorf("dry run wrote clusters")
	}

	// Real run.
	_, got = fx.A.Do("POST", path(org), body(false, "none", rows[:3]...))
	if a := actions(got); len(a) != 3 || a[0] != "create" || a[2] != "create" {
		t.Fatalf("import: %v", got)
	}
	sw := got["results"].([]any)[2].(map[string]any)
	if w := sw["warnings"].([]any); len(w) != 1 {
		t.Errorf("no subnet for 10.136.41.2: want one warning, got %v", w)
	}
	_, cl := fx.A.Do("GET", clustersPath(org), nil)
	clusters := cl["clusters"].([]any)
	if len(clusters) != 1 || clusters[0].(map[string]any)["mgmtIp"] != "10.136.4.101/24" || clusters[0].(map[string]any)["memberCount"] != float64(2) {
		t.Errorf("cluster with VIP from the subnet: %v", clusters)
	}
	swID := sw["deviceId"].(string)
	_, dev := fx.A.Do("GET", devicePath(org, swID), nil)
	if dev["mgmtIp"] != "10.136.41.2/32" || dev["mgmtInterfaceId"] == nil {
		t.Errorf("switch mgmt: %v %v", dev["mgmtIp"], dev["mgmtInterfaceId"])
	}
	_, ifs := fx.A.Do("GET", devicePath(org, swID)+"/interfaces", nil)
	if i := ifs["interfaces"].([]any); len(i) != 1 || i[0].(map[string]any)["name"] != "Vlan1" || i[0].(map[string]any)["kind"] != "svi" {
		t.Errorf("switch mgmt interface: %v", i)
	}
	fw := got["results"].([]any)[0].(map[string]any)["deviceId"].(string)
	if _, ips := fx.A.Do("GET", devicePath(org, fw)+"/ips", nil); len(ips["ips"].([]any)) != 0 {
		t.Errorf("cluster members carry no copy of the VIP: %v", ips)
	}

	// Re-import by hostname: updates, keeps what the file leaves empty, adds no second IP, reuses the cluster.
	again := row(4, "CSB220_HN", "l2_switch", hn, map[string]any{"mgmtIp": "10.136.41.2", "serialNumber": "DNI1"})
	_, got = fx.A.Do("POST", path(org), body(false, "hostname", rows[0], again))
	if a := actions(got); len(a) != 2 || a[0] != "update" || a[1] != "update" {
		t.Fatalf("re-import: %v", got)
	}
	_, dev = fx.A.Do("GET", devicePath(org, swID), nil)
	if dev["serialNumber"] != "DNI1" || dev["notes"] != "from excel" {
		t.Errorf("upsert overlay: serial %v notes %v", dev["serialNumber"], dev["notes"])
	}
	if _, ips := fx.A.Do("GET", devicePath(org, swID)+"/ips", nil); len(ips["ips"].([]any)) != 1 {
		t.Errorf("re-import duplicated the IP: %v", ips)
	}
	if _, cl := fx.A.Do("GET", clustersPath(org), nil); len(cl["clusters"].([]any)) != 1 {
		t.Errorf("re-import duplicated the cluster")
	}
	// Create-only mode refuses an existing hostname.
	_, got = fx.A.Do("POST", path(org), body(false, "none", again))
	if a := actions(got); a[0] != "error" {
		t.Errorf("create-only on an existing hostname: %v", got)
	}
}

// Management IP from the property panel: interface created when missing, address replaced, duplicates warned.
func TestSetDeviceMgmtIP(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))
	modem := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "MDM01", "type": "modem", "siteId": site}))
	sw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "SW01", "type": "l2_switch", "siteId": site}))
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "HN01", "name": "B"}))
	modemB := idOf(t, mustCreate(t, fx.B, devicesPath(fx.OrgB), map[string]any{"hostname": "B-MDM", "type": "modem", "siteId": siteB}))
	fx.AssertCrossTenantDenied(t, "PUT", func(o uuid.UUID) string { return devicePath(o, modemB) + "/mgmt-ip" }, map[string]any{"address": "10.9.9.9"})
	path := func(o uuid.UUID) string { return devicePath(o, modem) + "/mgmt-ip" }

	status, got := fx.A.Do("PUT", path(org), map[string]any{"address": "192.168.1.1"})
	if status != http.StatusOK || got["mgmtIp"] != "192.168.1.1/32" || got["interfaceName"] != "mgmt" || len(got["warnings"].([]any)) != 1 {
		t.Fatalf("first set: %d %v", status, got)
	}
	// The mask comes from IPAM once a subnet holds the address; the address on the interface is replaced, not added.
	mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "192.168.1.0/24", "siteId": site})
	if _, got = fx.A.Do("PUT", path(org), map[string]any{"address": "192.168.1.2"}); got["mgmtIp"] != "192.168.1.2/24" {
		t.Errorf("replace: %v", got)
	}
	if _, ips := fx.A.Do("GET", devicePath(org, modem)+"/ips", nil); len(ips["ips"].([]any)) != 1 {
		t.Errorf("one management address: %v", ips)
	}
	if _, dev := fx.A.Do("GET", devicePath(org, modem), nil); dev["mgmtIp"] != "192.168.1.2/24" {
		t.Errorf("device mgmt ip: %v", dev["mgmtIp"])
	}
	// A switch gets it on Vlan1; the same address as the modem is a warning, not a refusal.
	status, got = fx.A.Do("PUT", devicePath(org, sw)+"/mgmt-ip", map[string]any{"address": "192.168.1.2"})
	if status != http.StatusOK || got["interfaceName"] != "Vlan1" || len(got["warnings"].([]any)) != 1 {
		t.Errorf("switch: %d %v", status, got)
	}
	if status, _ := fx.A.Do("PUT", path(org), map[string]any{"address": "nope"}); status != http.StatusBadRequest {
		t.Errorf("bad address: %d", status)
	}
}
