package api

import (
	"net/http"
	"testing"
)

// P2-08 (ADR-047): off-page connectors — the detail lists the links with one end on the diagram and the other
// diagrams placing their far ends; connector positions the user moved are saved and checked.
func TestDiagramExternalLinks(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HQ01", "name": "HQ"}))
	dev := func(h string) string {
		return idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": h, "type": "l2_switch", "siteId": site}))
	}
	port := func(d, name string) string {
		return idOf(t, mustCreate(t, fx.A, devicePath(org, d)+"/interfaces", map[string]any{"name": name, "kind": "physical", "media": "RJ45"}))
	}
	acc, core, cam, other := dev("ACC"), dev("CORE"), dev("CAM"), dev("OTHER")
	link := func(a, ap, b, bp string) string {
		return idOf(t, mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(a, ap), "b": devEnd(b, bp), "kind": "ethernet"}))
	}
	toCore := link(acc, port(acc, "Gi1"), core, port(core, "Gi1"))
	toCam := link(acc, port(acc, "Gi2"), cam, port(cam, "eth0"))
	inside := link(acc, port(acc, "Gi3"), other, port(other, "Gi1"))
	link(core, port(core, "Gi2"), cam, port(cam, "eth1")) // neither end on the floor diagram

	mk := func(name string, refs ...string) string {
		id := idOf(t, mustCreate(t, fx.A, diagramsPath(org), map[string]any{"name": name, "layer": "physical"})["diagram"].(map[string]any))
		nodes := []map[string]any{}
		for i, r := range refs {
			nodes = append(nodes, node("n"+r[:8], "device", r, float64(i*200)))
		}
		if status, res := fx.A.Do("POST", diagramsPath(org)+"/"+id+"/save", map[string]any{"version": 1, "view": view(nodes)}); status != http.StatusOK {
			t.Fatalf("save %s: %d %v", name, status, res)
		}
		return id
	}
	floor := mk("Tầng 2", acc, other)
	server := mk("Phòng server", core)

	_, d := fx.A.Do("GET", diagramsPath(org)+"/"+floor, nil)
	ext := map[string]bool{}
	for _, l := range d["externalLinks"].([]any) {
		ext[l.(map[string]any)["id"].(string)] = true
	}
	if len(ext) != 2 || !ext[toCore] || !ext[toCam] || ext[inside] {
		t.Errorf("external links: %v", d["externalLinks"])
	}
	where := d["elsewhere"].([]any)
	if len(where) != 1 || where[0].(map[string]any)["refId"] != core {
		t.Fatalf("elsewhere: %v", where)
	}
	if ds := where[0].(map[string]any)["diagrams"].([]any); len(ds) != 1 || ds[0].(map[string]any)["id"] != server {
		t.Errorf("core is on the server room diagram: %v", ds)
	}

	// A moved connector is saved; a broken one is refused.
	v := view([]map[string]any{node("n"+acc[:8], "device", acc, 0), node("n"+other[:8], "device", other, 200)})
	v["stubs"] = []map[string]any{{"key": "n" + acc[:8] + ">d:" + server, "x": 400, "y": 50}}
	if status, res := fx.A.Do("POST", diagramsPath(org)+"/"+floor+"/save", map[string]any{"version": 2, "view": v}); status != http.StatusOK {
		t.Fatalf("save stubs: %d %v", status, res)
	}
	v["stubs"] = []map[string]any{{"key": "", "x": 0, "y": 0}}
	if status, _ := fx.A.Do("POST", diagramsPath(org)+"/"+floor+"/save", map[string]any{"version": 3, "view": v}); status != http.StatusBadRequest {
		t.Errorf("empty stub key: %d, want 400", status)
	}
	if status, _ := fx.B.Do("GET", diagramsPath(fx.OrgB)+"/"+floor, nil); status != http.StatusNotFound {
		t.Errorf("B reading A's diagram: %d", status)
	}
}
