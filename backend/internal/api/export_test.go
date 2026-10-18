package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// P1-22: exports made in the browser are recorded in the audit log; a diagram must be visible to the caller.
func TestRecordExport(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	dg := idOf(t, mustCreate(t, fx.A, diagramsPath(org), map[string]any{"name": "LAN", "layer": "physical"})["diagram"].(map[string]any))
	dgB := idOf(t, mustCreate(t, fx.B, diagramsPath(fx.OrgB), map[string]any{"name": "B", "layer": "physical"})["diagram"].(map[string]any))
	path := func(o uuid.UUID) string { return orgPath(o) + "/export-events" }
	fx.AssertCrossTenantDenied(t, "POST", path, map[string]any{"kind": "devices_xlsx", "count": 1})
	// A's member cannot record (nor probe) B's diagram through A's organization.
	if status, _ := fx.A.Do("POST", path(org), map[string]any{"kind": "diagram_png", "diagramId": dgB}); status != http.StatusNotFound {
		t.Errorf("other organization's diagram: %d", status)
	}
	if status, body := fx.A.Do("POST", path(org), map[string]any{"kind": "diagram_png", "diagramId": dg, "scale": 2}); status != http.StatusNoContent {
		t.Fatalf("record png: %d %v", status, body)
	}
	if status, body := fx.A.Do("POST", path(org), map[string]any{"kind": "diagram_pdf", "diagramId": dg, "paper": "a3", "count": 2}); status != http.StatusNoContent {
		t.Fatalf("record pdf: %d %v", status, body)
	}
	if status, _ := fx.A.Do("POST", path(org), map[string]any{"kind": "diagram_pdf", "diagramId": dgB}); status != http.StatusNotFound {
		t.Errorf("pdf of other organization's diagram: %d", status)
	}
	if status, _ := fx.A.Do("POST", path(org), map[string]any{"kind": "devices_xlsx", "count": 12}); status != http.StatusNoContent {
		t.Fatalf("record xlsx: %d", status)
	}
	if status, _ := fx.A.Do("POST", path(org), map[string]any{"kind": "diagram_svg"}); status != http.StatusBadRequest {
		t.Errorf("diagram export without a diagram: %d", status)
	}
	_, body := fx.A.Do("GET", auditPath(org)+"?action=export.diagram_png", nil)
	found := false
	for _, e := range entries(t, body) {
		if e["action"] == "export.diagram_png" && e["objectId"] == dg {
			found = true
		}
	}
	if !found {
		t.Errorf("export.diagram_png not in the audit log: %v", body)
	}
}
