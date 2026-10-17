package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/ntbschema"
)

// P1-22 / ADR-037: a diagram exported as .ntb.json (valid against schema/ntb.schema.json, no secret) and imported into
// another organization as a new diagram with new ids; a second import reuses what is there.
func TestNtbExportImport(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))
	cl := idOf(t, mustCreate(t, fx.A, clustersPath(org), map[string]any{"kind": "ha_active_passive", "name": "FW-HA", "hostname": "FW", "siteId": site}))
	fw1 := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "FW", "type": "firewall", "siteId": site, "clusterId": cl, "clusterRole": "primary", "clusterMemberNo": 1, "serialNumber": "S1"}))
	fw2 := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "FW", "type": "firewall", "siteId": site, "clusterId": cl, "clusterRole": "secondary", "clusterMemberNo": 2}))
	sw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "SW", "type": "poe_switch", "siteId": site}))
	port := func(dev, name string) string {
		return idOf(t, mustCreate(t, fx.A, devicePath(org, dev)+"/interfaces", map[string]any{"name": name, "kind": "physical", "media": "RJ45"}))
	}
	fwP, swUp, swP1, swP2 := port(fw1, "port1"), port(sw, "Gi1/0/24"), port(sw, "Gi1/0/1"), port(sw, "Gi1/0/2")
	svi := idOf(t, mustCreate(t, fx.A, devicePath(org, sw)+"/interfaces", map[string]any{"name": "Vlan1", "kind": "svi"}))
	mustCreate(t, fx.A, devicePath(org, sw)+"/ips", map[string]any{"interfaceId": svi, "address": "10.0.0.2/24", "role": "primary"})
	sn := idOf(t, mustCreate(t, fx.A, subnetsPath(org), map[string]any{"cidr": "10.0.20.0/24", "siteId": site}))
	rng := idOf(t, mustCreate(t, fx.A, subnetsPath(org)+"/"+sn+"/ranges", map[string]any{"startIp": "10.0.20.10", "endIp": "10.0.20.60", "kind": "static"}))
	cams := idOf(t, mustCreate(t, fx.A, orgPath(org)+"/endpoint-groups", map[string]any{"kind": "ip_camera", "name": "Cameras", "siteId": site, "ipRangeId": rng, "expectedCount": 2}))
	link := func(a, b map[string]any) string {
		return idOf(t, mustCreate(t, fx.A, linksPath(org), map[string]any{"a": a, "b": b, "kind": "ethernet"}))
	}
	l1 := link(devEnd(fw1, fwP), devEnd(sw, swUp))
	l2 := link(devEnd(sw, swP1), map[string]any{"kind": "endpoint_group", "id": cams})
	l3 := link(devEnd(sw, swP2), map[string]any{"kind": "endpoint_group", "id": cams})
	dg := idOf(t, mustCreate(t, fx.A, diagramsPath(org), map[string]any{"name": "CCTV", "layer": "physical"})["diagram"].(map[string]any))
	v := view([]map[string]any{node("n1", "device", fw1, 0), node("n2", "device", fw2, 200), node("n3", "device", sw, 400), node("n4", "endpoint_group", cams, 600)})
	v["edges"] = []map[string]any{{"id": "e1", "linkId": l1}, {"id": "e2", "linkId": l2}, {"id": "e3", "linkId": l3}}
	v["annotations"] = []map[string]any{{"id": "f1", "kind": "zone", "x": -50, "y": -50, "width": 900, "height": 300, "siteId": site}}
	v["portStyle"] = "cisco"
	if status, res := fx.A.Do("POST", diagramsPath(org)+"/"+dg+"/save", map[string]any{"version": 1, "view": v}); status != http.StatusOK {
		t.Fatalf("save: %d %v", status, res)
	}

	exportPath := func(o uuid.UUID) string { return diagramsPath(o) + "/" + dg + "/ntb" }
	if status, _ := fx.B.Do("GET", exportPath(fx.OrgB), nil); status != http.StatusNotFound {
		t.Errorf("B exports A's diagram through its org: %d", status)
	}
	status, file := fx.A.Do("GET", exportPath(org), nil)
	if status != http.StatusOK {
		t.Fatalf("export: %d %v", status, file)
	}
	raw, _ := json.Marshal(file)
	if err := ntbschema.Validate(raw); err != nil {
		t.Fatalf("exported file does not match the schema: %v", err)
	}
	count := func(k string) int { return len(file[k].([]any)) }
	if count("devices") != 3 || count("links") != 3 || count("endpointGroups") != 1 || count("clusters") != 1 || count("ranges") != 1 {
		t.Errorf("exported: devices %d links %d groups %d clusters %d ranges %d", count("devices"), count("links"), count("endpointGroups"), count("clusters"), count("ranges"))
	}

	// Into B: preview (no site matches yet), then a site to land on, then the import.
	_, preview := fx.B.Do("POST", orgPath(fx.OrgB)+"/ntb-imports/preview", map[string]any{"file": file})
	if sites := preview["sites"].([]any); len(sites) != 1 || sites[0].(map[string]any)["siteId"] != nil {
		t.Errorf("preview sites: %v", preview)
	}
	siteRef := preview["sites"].([]any)[0].(map[string]any)["ref"].(string)
	if status, body := fx.B.Do("POST", orgPath(fx.OrgB)+"/ntb-imports", map[string]any{"file": file, "siteMap": map[string]any{}, "deviceActions": map[string]any{}, "diagramName": "CCTV"}); status != http.StatusBadRequest {
		t.Errorf("import without a target site: %d %v", status, body)
	}
	// A's site id is refused as a target in B (it is not B's).
	if status, _ := fx.B.Do("POST", orgPath(fx.OrgB)+"/ntb-imports", map[string]any{"file": file, "siteMap": map[string]any{siteRef: site}, "deviceActions": map[string]any{}, "diagramName": "CCTV"}); status == http.StatusOK {
		t.Errorf("import into another organization's site accepted")
	}
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "SGN01", "name": "Saigon"}))
	status, res := fx.B.Do("POST", orgPath(fx.OrgB)+"/ntb-imports", map[string]any{"file": file, "siteMap": map[string]any{siteRef: siteB}, "deviceActions": map[string]any{}, "diagramName": "CCTV"})
	if status != http.StatusOK {
		t.Fatalf("import: %d %v", status, res)
	}
	created := res["created"].(map[string]any)
	if created["devices"] != float64(3) || created["links"] != float64(3) || created["endpointGroups"] != float64(1) || created["clusters"] != float64(1) {
		t.Errorf("created: %v (warnings %v)", created, res["warnings"])
	}
	newDg := res["diagramId"].(string)
	if newDg == dg {
		t.Error("the import reused the file's id")
	}
	_, detail := fx.B.Do("GET", diagramsPath(fx.OrgB)+"/"+newDg, nil)
	view := detail["view"].(map[string]any)
	if len(view["nodes"].([]any)) != 4 || len(view["edges"].([]any)) != 3 || view["portStyle"] != "cisco" {
		t.Errorf("imported view: %v", view)
	}
	if ann := view["annotations"].([]any)[0].(map[string]any); ann["siteId"] != siteB {
		t.Errorf("frame bound to the target site: %v", ann)
	}
	_, list := fx.B.Do("GET", devicesPath(fx.OrgB), nil)
	if len(list["devices"].([]any)) != 3 {
		t.Errorf("devices in B: %d", len(list["devices"].([]any)))
	}
	// The switch kept its ports and IP.
	for _, d := range list["devices"].([]any) {
		dd := d.(map[string]any)
		if dd["hostname"] != "SW" {
			continue
		}
		_, ips := fx.B.Do("GET", devicePath(fx.OrgB, dd["id"].(string))+"/ips", nil)
		if l := ips["ips"].([]any); len(l) != 1 || l[0].(map[string]any)["address"] != "10.0.0.2/24" || l[0].(map[string]any)["interfaceName"] != "Vlan1" {
			t.Errorf("switch IP after import: %v", ips)
		}
		_, ifs := fx.B.Do("GET", devicePath(fx.OrgB, dd["id"].(string))+"/interfaces", nil)
		if len(ifs["interfaces"].([]any)) != 4 {
			t.Errorf("switch ports after import: %d", len(ifs["interfaces"].([]any)))
		}
	}

	// Again into B, another name: everything is reused, nothing duplicated.
	if status, _ := fx.B.Do("POST", orgPath(fx.OrgB)+"/ntb-imports", map[string]any{"file": file, "siteMap": map[string]any{siteRef: siteB}, "deviceActions": map[string]any{}, "diagramName": "CCTV"}); status != http.StatusConflict {
		t.Errorf("same diagram name: %d", status)
	}
	status, res = fx.B.Do("POST", orgPath(fx.OrgB)+"/ntb-imports", map[string]any{"file": file, "siteMap": map[string]any{siteRef: siteB}, "deviceActions": map[string]any{}, "diagramName": "CCTV 2"})
	if status != http.StatusOK {
		t.Fatalf("second import: %d %v", status, res)
	}
	if c := res["created"].(map[string]any); c["devices"] != float64(0) || c["links"] != float64(0) || c["endpointGroups"] != float64(0) {
		t.Errorf("second import created: %v", c)
	}
	if _, list = fx.B.Do("GET", devicesPath(fx.OrgB), nil); len(list["devices"].([]any)) != 3 {
		t.Errorf("devices after the second import: %d", len(list["devices"].([]any)))
	}
	// Both cluster members are on the second diagram (not one of them twice).
	_, d2 := fx.B.Do("GET", diagramsPath(fx.OrgB)+"/"+res["diagramId"].(string), nil)
	refs := map[string]bool{}
	for _, n := range d2["view"].(map[string]any)["nodes"].([]any) {
		refs[n.(map[string]any)["refId"].(string)] = true
	}
	if len(refs) != 4 {
		t.Errorf("second diagram refers to %d objects, want 4 (two cluster members, switch, group)", len(refs))
	}
	// The export is audited.
	_, audit := fx.A.Do("GET", auditPath(org)+"?action=export.diagram_ntb", nil)
	if len(entries(t, audit)) == 0 {
		t.Error("export.diagram_ntb not audited")
	}
}
