package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func diagramsPath(org uuid.UUID) string { return orgPath(org) + "/diagrams" }

func node(id, kind, ref string, x float64) map[string]any {
	return map[string]any{"id": id, "refKind": kind, "refId": ref, "x": x, "y": 0}
}

func view(nodes []map[string]any, edges ...map[string]any) map[string]any {
	if edges == nil {
		edges = []map[string]any{}
	}
	return map[string]any{"nodes": nodes, "edges": edges, "annotations": []any{}, "viewport": map[string]any{"x": 0, "y": 0, "zoom": 1}}
}

// Cross-tenant isolation for every diagram endpoint, plus placing another org's objects on a diagram.
func TestDiagramEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	unitB := mustCategory(t, fx.B, fx.OrgB, "FOOD")
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "HN01", "name": "B", "categoryId": unitB}))
	devB := idOf(t, mustCreate(t, fx.B, devicesPath(fx.OrgB), map[string]any{"hostname": "B-SW1", "type": "l2_switch", "siteId": siteB}))
	dB := mustCreate(t, fx.B, diagramsPath(fx.OrgB), map[string]any{"name": "LAN"})
	dID := dB["diagram"].(map[string]any)["id"].(string)
	d := func(o uuid.UUID) string { return diagramsPath(o) + "/" + dID }
	fx.AssertCrossTenantDenied(t, "GET", diagramsPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", diagramsPath, map[string]any{"name": "X"})
	fx.AssertCrossTenantDenied(t, "GET", d, nil)
	for _, org := range []uuid.UUID{fx.OrgB, fx.OrgA} {
		for _, r := range []struct {
			method, path string
			body         map[string]any
		}{
			{"PATCH", d(org), map[string]any{"name": "HACK", "version": 1}},
			{"POST", d(org) + "/save", map[string]any{"version": 1, "view": view(nil)}},
			{"DELETE", d(org), nil},
		} {
			if status, _ := fx.A.Do(r.method, r.path, r.body); status != http.StatusNotFound {
				t.Errorf("A %s %s: %d, want 404", r.method, r.path, status)
			}
		}
	}
	// A's diagram cannot show B's device or sit in B's site.
	a := mustCreate(t, fx.A, diagramsPath(fx.OrgA), map[string]any{"name": "Tổng quan"})
	aID := a["diagram"].(map[string]any)["id"].(string)
	if status, _ := fx.A.Do("POST", diagramsPath(fx.OrgA)+"/"+aID+"/save", map[string]any{"version": 1, "view": view([]map[string]any{node("n1", "device", devB, 0)})}); status != http.StatusBadRequest {
		t.Errorf("A places B's device: %d, want 400", status)
	}
	if _, got := fx.B.Do("GET", d(fx.OrgB), nil); got["diagram"].(map[string]any)["name"] != "LAN" {
		t.Errorf("B's diagram changed: %v", got)
	}
}

func TestDiagramSaveWithInventoryChanges(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	nm := mustCategory(t, fx.A, org, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "BD", "categoryId": nm}))
	fw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "BD-FW01", "type": "firewall", "siteId": bd}))
	for name, body := range map[string]map[string]any{
		"no name":   {"name": " "},
		"bad layer": {"name": "X", "layer": "l7"},
	} {
		if status, _ := fx.A.Do("POST", diagramsPath(org), body); status != http.StatusBadRequest {
			t.Errorf("diagram %s: %d, want 400", name, status)
		}
	}
	created := mustCreate(t, fx.A, diagramsPath(org), map[string]any{"name": "LAN Bình Định", "layer": "physical"})
	dg := created["diagram"].(map[string]any)
	if dg["access"] != "admin" || len(created["view"].(map[string]any)["nodes"].([]any)) != 0 {
		t.Errorf("diagram created as %v", created)
	}
	id := dg["id"].(string)
	if status, _ := fx.A.Do("POST", diagramsPath(org), map[string]any{"name": "lan bình định"}); status != http.StatusConflict {
		t.Errorf("duplicate name: %d, want 409", status)
	}
	save := diagramsPath(org) + "/" + id + "/save"

	// One save: a new switch (temp id), a link from the firewall to it, both drawn.
	sw, ln := uuid.NewString(), uuid.NewString()
	body := map[string]any{
		"version": 1,
		"view": view([]map[string]any{node("n-fw", "device", fw, 0), node("n-sw", "device", sw, 200)},
			map[string]any{"id": "e1", "linkId": ln, "routing": "orthogonal"}),
		"changes": []map[string]any{
			{"op": "createDevice", "tempId": sw, "device": map[string]any{"hostname": "BD-SW01", "type": "poe_switch", "siteId": bd}},
			{"op": "createLink", "tempId": ln, "link": map[string]any{"a": devEnd(fw, ""), "b": devEnd(sw, ""), "kind": "ethernet"}},
		},
	}
	status, res := fx.A.Do("POST", save, body)
	if status != http.StatusOK {
		t.Fatalf("save: %d %v", status, res)
	}
	idMap := res["idMap"].(map[string]any)
	realSw, realLn := idMap[sw].(string), idMap[ln].(string)
	detail := res["detail"].(map[string]any)
	nodes := detail["view"].(map[string]any)["nodes"].([]any)
	edges := detail["view"].(map[string]any)["edges"].([]any)
	if realSw == "" || realLn == "" || nodes[1].(map[string]any)["refId"] != realSw || edges[0].(map[string]any)["linkId"] != realLn ||
		len(detail["devices"].([]any)) != 2 || len(detail["links"].([]any)) != 1 || detail["diagram"].(map[string]any)["version"] != float64(2) ||
		detail["diagram"].(map[string]any)["nodeCount"] != float64(2) {
		t.Errorf("save result: %v", res)
	}
	// Stale version: refused, nothing written.
	if status, _ := fx.A.Do("POST", save, map[string]any{"version": 1, "view": view(nil)}); status != http.StatusConflict {
		t.Errorf("stale save: %d, want 409", status)
	}
	// All or nothing: the second change fails (hostname taken), so the first is rolled back too.
	ap := uuid.NewString()
	status, _ = fx.A.Do("POST", save, map[string]any{"version": 2, "view": view([]map[string]any{node("n-fw", "device", fw, 0)}),
		"changes": []map[string]any{
			{"op": "createDevice", "tempId": ap, "device": map[string]any{"hostname": "BD-AP01", "type": "access_point", "siteId": bd}},
			{"op": "createDevice", "tempId": uuid.NewString(), "device": map[string]any{"hostname": "bd-sw01", "type": "poe_switch", "siteId": bd}},
		}})
	if status != http.StatusConflict {
		t.Errorf("save with a failing change: %d, want 409", status)
	}
	if _, l := fx.A.Do("GET", devicesPath(org)+"?q=BD-AP01", nil); l["total"] != float64(0) {
		t.Errorf("rolled back device exists: %v", l["total"])
	}
	if _, g := fx.A.Do("GET", diagramsPath(org)+"/"+id, nil); g["diagram"].(map[string]any)["version"] != float64(2) {
		t.Errorf("version after a refused save: %v", g["diagram"])
	}
	for name, v := range map[string]map[string]any{
		"duplicate node ids": view([]map[string]any{node("n", "device", fw, 0), node("n", "device", realSw, 1)}),
		"unknown device":     view([]map[string]any{node("n", "device", uuid.NewString(), 0)}),
		"unknown link":       view([]map[string]any{node("n", "device", fw, 0)}, map[string]any{"id": "e", "linkId": uuid.NewString()}),
		"bad zoom":           {"nodes": []any{}, "edges": []any{}, "annotations": []any{}, "viewport": map[string]any{"x": 0, "y": 0, "zoom": 100}},
	} {
		if status, _ := fx.A.Do("POST", save, map[string]any{"version": 2, "view": v}); status != http.StatusBadRequest {
			t.Errorf("save %s: %d, want 400", name, status)
		}
	}
	// Removing from the diagram is a view change; deleting from the inventory is an explicit change (links go too).
	status, res = fx.A.Do("POST", save, map[string]any{"version": 2, "view": view([]map[string]any{node("n-fw", "device", fw, 0)}),
		"changes": []map[string]any{{"op": "deleteDevice", "id": realSw}}})
	if status != http.StatusOK || len(res["detail"].(map[string]any)["links"].([]any)) != 0 {
		t.Errorf("delete from inventory: %d %v", status, res)
	}
	if _, l := fx.A.Do("GET", linksPath(org), nil); len(l["links"].([]any)) != 0 {
		t.Errorf("links after deleting the switch: %v", l)
	}
	if status, _ := fx.A.Do("PATCH", diagramsPath(org)+"/"+id, map[string]any{"name": "LAN BD", "layer": "l2", "version": 3}); status != http.StatusOK {
		t.Errorf("rename: %d", status)
	}
	if status, _ := fx.A.Do("DELETE", diagramsPath(org)+"/"+id, nil); status != http.StatusNoContent {
		t.Errorf("delete diagram: %d", status)
	}
	if _, l := fx.A.Do("GET", devicesPath(org)+"?q=BD-FW01", nil); l["total"] != float64(1) {
		t.Errorf("deleting a diagram must keep the inventory: %v", l["total"])
	}
	for _, a := range []string{"diagram.create", "diagram.save", "diagram.update", "diagram.delete", "device.create", "link.create"} {
		if auditCount(t, fx.Pool, a, org) == 0 {
			t.Errorf("no %s audit", a)
		}
	}
}

func TestDiagramPermissions(t *testing.T) {
	w := newRoleWorld(t)
	org := w.fx.OrgA
	d := mustCreate(t, w.editor, diagramsPath(org), map[string]any{"name": "Tổng quan"})
	id := d["diagram"].(map[string]any)["id"].(string)
	if status, got := w.viewer.Do("GET", diagramsPath(org)+"/"+id, nil); status != http.StatusOK || got["diagram"].(map[string]any)["access"] != "view" {
		t.Errorf("viewer reads a diagram: %d", status)
	}
	for _, r := range []struct {
		method, path string
		body         map[string]any
	}{
		{"POST", diagramsPath(org), map[string]any{"name": "X"}},
		{"POST", diagramsPath(org) + "/" + id + "/save", map[string]any{"version": 1, "view": view(nil)}},
		{"PATCH", diagramsPath(org) + "/" + id, map[string]any{"name": "X", "version": 1}},
		{"DELETE", diagramsPath(org) + "/" + id, nil},
	} {
		if status, _ := w.viewer.Do(r.method, r.path, r.body); status != http.StatusForbidden {
			t.Errorf("viewer %s %s: %d, want 403", r.method, r.path, status)
		}
	}
}

// P1-17: a cable drawn onto a port of a device created in the same save — the port comes from the template and is
// named by a client temp id until the save maps it.
func TestDiagramSaveCablesNewDevicePorts(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "BD"}))
	fw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "BD-FW01", "type": "firewall", "siteId": bd}))
	fwPort := idOf(t, mustCreate(t, fx.A, devicePath(org, fw)+"/interfaces", map[string]any{"name": "port1", "kind": "physical", "media": "RJ45"}))
	tpl := idOf(t, mustCreate(t, fx.A, orgPath(org)+"/device-templates", map[string]any{"name": "SW24", "type": "poe_switch",
		"ports": []map[string]any{{"pattern": "Gi1/0/{n}", "start": 1, "count": 24, "media": "RJ45", "speed": "1G"}}}))
	dg := idOf(t, mustCreate(t, fx.A, diagramsPath(org), map[string]any{"name": "LAN", "layer": "physical"})["diagram"].(map[string]any))
	sw, ln, gi24 := uuid.NewString(), uuid.NewString(), uuid.NewString()
	save := func(portName string) (int, map[string]any) {
		return fx.A.Do("POST", diagramsPath(org)+"/"+dg+"/save", map[string]any{
			"version": 1,
			"view":    view([]map[string]any{node("n-fw", "device", fw, 0), node("n-sw", "device", sw, 200)}),
			"changes": []map[string]any{
				{"op": "createDevice", "tempId": sw, "device": map[string]any{"hostname": "BD-SW01", "type": "poe_switch", "siteId": bd, "templateId": tpl},
					"portTempIds": []map[string]any{{"name": portName, "tempId": gi24}}},
				{"op": "createLink", "tempId": ln, "link": map[string]any{"a": devEnd(fw, fwPort), "b": devEnd(sw, gi24), "kind": "ethernet"}},
			},
		})
	}
	// A name the template does not generate is refused, and nothing is kept.
	if status, body := save("Gi1/0/99"); status != http.StatusBadRequest {
		t.Fatalf("unknown port: %d %v", status, body)
	}
	status, res := save("gi1/0/24")
	if status != http.StatusOK {
		t.Fatalf("save: %d %v", status, res)
	}
	idMap := res["idMap"].(map[string]any)
	if idMap[gi24] == nil || idMap[sw] == nil {
		t.Fatalf("idMap: %v", idMap)
	}
	_, links := fx.A.Do("GET", linksPath(org)+"?endId="+fw, nil)
	l := links["links"].([]any)[0].(map[string]any)
	if l["b"].(map[string]any)["interfaceName"] != "Gi1/0/24" || l["b"].(map[string]any)["interfaceId"] != idMap[gi24] {
		t.Errorf("cable on the new switch: %v", l["b"])
	}
}

// P1-19 / ADR-032: frames (zone annotations) bound to a site / location of the organization.
func TestDiagramFrames(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	hcm := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))
	hn := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HN01", "name": "HN"}))
	room := idOf(t, mustCreate(t, fx.A, sitesPath(org)+"/"+hcm+"/locations", map[string]any{"kind": "room", "name": "Phòng máy"}))
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "B01", "name": "B"}))
	dg := idOf(t, mustCreate(t, fx.A, diagramsPath(org), map[string]any{"name": "Frames", "layer": "physical"})["diagram"].(map[string]any))
	save := func(version int, ann ...map[string]any) (int, map[string]any) {
		return fx.A.Do("POST", diagramsPath(org)+"/"+dg+"/save", map[string]any{
			"version": version, "view": map[string]any{"nodes": []any{}, "edges": []any{}, "annotations": ann},
		})
	}
	frame := func(site, loc string) map[string]any {
		a := map[string]any{"id": "f1", "kind": "zone", "x": 0, "y": 0, "width": 400, "height": 300, "siteId": site}
		if loc != "" {
			a["locationId"] = loc
		}
		return a
	}
	for name, c := range map[string]map[string]any{
		"another org's site":       frame(siteB, ""),
		"location of another site": frame(hn, room),
		"location without site":    {"id": "f1", "kind": "zone", "x": 0, "y": 0, "locationId": room},
		"site on a text":           {"id": "t1", "kind": "text", "x": 0, "y": 0, "siteId": hcm},
		"font too big":             {"id": "t1", "kind": "text", "x": 0, "y": 0, "text": "x", "fontSize": 300},
		"negative size":            {"id": "f1", "kind": "zone", "x": 0, "y": 0, "width": -5, "height": 10},
		"bad arrow style":          {"id": "a1", "kind": "arrow", "x": 0, "y": 0, "lineStyle": "wavy"},
	} {
		if status, body := save(1, c); status != http.StatusBadRequest {
			t.Errorf("%s: %d %v, want 400", name, status, body)
		}
	}
	status, body := save(1, frame(hcm, room),
		map[string]any{"id": "t1", "kind": "text", "x": 10, "y": 10, "text": "FPT IDC", "color": "blue", "fontSize": 16},
		map[string]any{"id": "a1", "kind": "arrow", "x": 0, "y": 0, "points": []map[string]any{{"x": 120, "y": 40}}, "lineStyle": "dashed"})
	if status != http.StatusOK {
		t.Fatalf("save frames: %d %v", status, body)
	}
	anns := body["detail"].(map[string]any)["view"].(map[string]any)["annotations"].([]any)
	if len(anns) != 3 || anns[0].(map[string]any)["locationId"] != room {
		t.Errorf("annotations stored as %v", anns)
	}
	// A stored binding stays valid after its site is deleted (shown as deleted, not a save error).
	if status, _ := fx.A.Do("DELETE", sitesPath(org)+"/"+hcm, nil); status != http.StatusNoContent {
		t.Logf("site delete: %d (site may still be in use)", status)
	}
	if status, body := save(2, frame(hcm, room)); status != http.StatusOK {
		t.Errorf("re-save with the stored binding: %d %v", status, body)
	}
}
