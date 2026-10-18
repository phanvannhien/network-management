package api

import (
	"net/http"
	"testing"
)

// P2-08 (ADR-047): pages of one diagram — saved in the view, checked (known page, one placement per page), a device on
// several pages, and kept through a .ntb.json export / import.
func TestDiagramPages(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HQ01", "name": "HQ"}))
	core := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "CORE", "type": "l3_switch", "siteId": site}))
	acc := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "ACC-T2", "type": "poe_switch", "siteId": site}))
	dg := mustCreate(t, fx.A, diagramsPath(org), map[string]any{"name": "HQ", "layer": "physical"})["diagram"].(map[string]any)
	id := dg["id"].(string)
	version := 1
	save := func(v map[string]any) (int, map[string]any) {
		status, res := fx.A.Do("POST", diagramsPath(org)+"/"+id+"/save", map[string]any{"version": version, "view": v})
		if status == http.StatusOK {
			version = int(res["detail"].(map[string]any)["diagram"].(map[string]any)["version"].(float64))
		}
		return status, res
	}
	pages := []map[string]any{{"id": "p1", "name": "Phòng server", "layer": "physical"}, {"id": "p2", "name": "Tầng 2", "layer": "l2"}}
	onPage := func(n map[string]any, page string) map[string]any { n["pageId"] = page; return n }

	// The core on both pages (a landmark on the floor page), the floor switch on page 2.
	v := view([]map[string]any{node("n1", "device", core, 0), onPage(node("n2", "device", core, 0), "p2"), onPage(node("n3", "device", acc, 200), "p2")})
	v["pages"] = pages
	v["annotations"] = []map[string]any{{"id": "t1", "kind": "text", "x": 0, "y": 0, "text": "Tầng 2", "pageId": "p2"}}
	if status, res := save(v); status != http.StatusOK {
		t.Fatalf("save with pages: %d %v", status, res)
	}
	_, d := fx.A.Do("GET", diagramsPath(org)+"/"+id, nil)
	got := d["view"].(map[string]any)
	if ps := got["pages"].([]any); len(ps) != 2 || ps[1].(map[string]any)["name"] != "Tầng 2" || ps[1].(map[string]any)["layer"] != "l2" {
		t.Errorf("pages: %v", got["pages"])
	}

	bad := []struct {
		name string
		v    func() map[string]any
	}{
		{"unknown page", func() map[string]any {
			x := view([]map[string]any{onPage(node("n1", "device", core, 0), "p9")})
			x["pages"] = pages
			return x
		}},
		{"same device twice on one page", func() map[string]any {
			x := view([]map[string]any{onPage(node("n1", "device", core, 0), "p2"), onPage(node("n2", "device", core, 100), "p2")})
			x["pages"] = pages
			return x
		}},
		{"page id without pages", func() map[string]any {
			return view([]map[string]any{onPage(node("n1", "device", core, 0), "p2")})
		}},
		{"duplicate page ids", func() map[string]any {
			x := view([]map[string]any{node("n1", "device", core, 0)})
			x["pages"] = []map[string]any{{"id": "p1", "name": "A", "layer": "physical"}, {"id": "p1", "name": "B", "layer": "physical"}}
			return x
		}},
		{"empty page name", func() map[string]any {
			x := view([]map[string]any{node("n1", "device", core, 0)})
			x["pages"] = []map[string]any{{"id": "p1", "name": " ", "layer": "physical"}}
			return x
		}},
	}
	for _, c := range bad {
		if status, _ := save(c.v()); status != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", c.name, status)
		}
	}

	// Export keeps the pages; import into org B brings them back.
	status, file := fx.A.Do("GET", diagramsPath(org)+"/"+id+"/ntb", nil)
	if status != http.StatusOK || file["schemaVersion"] != "2.1.0" {
		t.Fatalf("export: %d %v", status, file["schemaVersion"])
	}
	_, preview := fx.B.Do("POST", orgPath(fx.OrgB)+"/ntb-imports/preview", map[string]any{"file": file})
	siteRef := preview["sites"].([]any)[0].(map[string]any)["ref"].(string)
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "B01", "name": "B"}))
	status, res := fx.B.Do("POST", orgPath(fx.OrgB)+"/ntb-imports", map[string]any{"file": file, "siteMap": map[string]any{siteRef: siteB},
		"deviceActions": map[string]any{}, "diagramName": "HQ"})
	if status != http.StatusOK {
		t.Fatalf("import: %d %v", status, res)
	}
	_, imported := fx.B.Do("GET", diagramsPath(fx.OrgB)+"/"+res["diagramId"].(string), nil)
	iv := imported["view"].(map[string]any)
	onP2 := 0
	for _, n := range iv["nodes"].([]any) {
		if n.(map[string]any)["pageId"] == "p2" {
			onP2++
		}
	}
	if len(iv["pages"].([]any)) != 2 || onP2 != 2 || iv["annotations"].([]any)[0].(map[string]any)["pageId"] != "p2" {
		t.Errorf("imported view lost its pages: %v", iv)
	}
}
