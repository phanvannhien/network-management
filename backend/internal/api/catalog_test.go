package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/catalog"
)

// ADR-035: every catalog entry is a valid template (ports expand, names unique, sizes within limits).
func TestCatalogData(t *testing.T) {
	if err := catalog.Load(); err != nil {
		t.Fatal(err)
	}
	for _, c := range catalog.All() {
		ports, u := c.Ports, c.UHeight
		if _, msg := validateTemplate(c.Vendor+" "+c.Model, c.Type, &c.Vendor, &c.Model, nil, nil, &u, &ports); msg != "" {
			t.Errorf("%s: %s", c.Id, msg)
		}
		// Stack members get their own names ({m}); member 2 must expand too.
		if _, msg := expandPorts(c.Ports, 2); msg != "" {
			t.Errorf("%s (member 2): %s", c.Id, msg)
		}
	}
}

func TestTemplateFromCatalog(t *testing.T) {
	all := catalog.All()
	if len(all) == 0 {
		t.Skip("empty catalog")
	}
	c := all[0]
	fx := newOrgFixture(t)
	path := func(o uuid.UUID) string { return orgPath(o) + "/device-templates/from-catalog" }
	fx.AssertCrossTenantDenied(t, "POST", path, map[string]any{"catalogId": c.Id})
	fx.AssertCrossTenantDenied(t, "GET", func(o uuid.UUID) string { return orgPath(o) + "/device-catalog" }, nil)

	if _, got := fx.A.Do("GET", orgPath(fx.OrgA)+"/device-catalog", nil); len(got["models"].([]any)) != len(all) {
		t.Errorf("catalog list: %d models", len(got["models"].([]any)))
	}
	status, first := fx.A.Do("POST", path(fx.OrgA), map[string]any{"catalogId": c.Id})
	if status != http.StatusCreated || first["portCount"] != float64(c.PortCount) || first["model"] != c.Model {
		t.Fatalf("from catalog: %d %v", status, first)
	}
	// Again: the template the organization has is returned, not a copy.
	status, again := fx.A.Do("POST", path(fx.OrgA), map[string]any{"catalogId": c.Id})
	if status != http.StatusOK || again["id"] != first["id"] {
		t.Errorf("second copy: %d %v", status, again)
	}
	if status, _ := fx.A.Do("POST", path(fx.OrgA), map[string]any{"catalogId": "no-such-model"}); status != http.StatusNotFound {
		t.Errorf("unknown model: %d", status)
	}
	// Org B has its own copy (the tenant check above may have created it already).
	if status, b := fx.B.Do("POST", path(fx.OrgB), map[string]any{"catalogId": c.Id}); status >= 300 || b["id"] == first["id"] {
		t.Errorf("org B copy: %d %v", status, b)
	}
}
