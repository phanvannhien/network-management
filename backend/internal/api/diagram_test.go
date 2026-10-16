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
