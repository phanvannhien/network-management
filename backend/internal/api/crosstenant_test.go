package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// P2-01: endpoints the security review found without a cross-tenant test. Org B, through its own organization
// path, must not touch org A's objects by id, nor use A's site / category as a target.
func TestCrossTenantGaps(t *testing.T) {
	fx := newOrgFixture(t)
	a, b := fx.OrgA, fx.OrgB

	fx.AssertCrossTenantDenied(t, "POST", func(o uuid.UUID) string { return orgPath(o) + "/notifications/seen" }, nil)

	vid := mustCreate(t, fx.A, vendorsPath(a), map[string]any{"kind": "isp", "name": "Viettel"})["id"].(string)
	contact := mustCreate(t, fx.A, vendorsPath(a)+"/"+vid+"/contacts", map[string]any{"name": "Anh Nam"})
	if status, _ := fx.B.Do("POST", vendorsPath(b)+"/"+vid+"/contacts", map[string]any{"name": "X"}); status != http.StatusNotFound {
		t.Errorf("B adding a contact to A's vendor: %d, want 404", status)
	}
	if status, _ := fx.B.Do("PATCH", orgPath(b)+"/vendor-contacts/"+contact["id"].(string), contact); status != http.StatusNotFound {
		t.Errorf("B editing A's contact: %d, want 404", status)
	}

	catA := mustCategory(t, fx.A, a, "MIEN")
	if status, _ := fx.B.Do("GET", sitesPath(b)+"/next-code?place=HN&categoryId="+catA, nil); status != http.StatusNotFound {
		t.Errorf("B suggesting a code in A's category: %d, want 404", status)
	}
	design := map[string]any{"scenario": "small", "vendor": "fortinet_cisco", "users": 20, "categoryId": catA, "diagramName": "X"}
	for _, step := range []string{"preview", "apply"} {
		if status, _ := fx.B.Do("POST", designPath(b, step), design); status < 400 {
			t.Errorf("B design %s into A's category: %d, want a refusal", step, status)
		}
	}
	if _, list := fx.A.Do("GET", sitesPath(a), nil); len(list["sites"].([]any)) != 0 {
		t.Errorf("B's design landed sites in A: %v", list)
	}
}
