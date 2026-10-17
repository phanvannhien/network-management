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

// ADR-035 rev.: a device made from a system template gets its ports and identity without copying the template.
func TestDeviceFromSystemTemplate(t *testing.T) {
	c, ok := catalog.Get("cisco-c1300-24t-4g")
	if !ok {
		t.Skip("model not in catalog")
	}
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))
	status, dev := fx.A.Do("POST", devicesPath(org), map[string]any{"hostname": "SW1", "type": "l2_switch", "siteId": site, "catalogId": c.Id})
	if status != http.StatusCreated || dev["catalogId"] != c.Id || dev["model"] != c.Model || dev["vendor"] != "Cisco" {
		t.Fatalf("create from catalog: %d %v", status, dev)
	}
	id := dev["id"].(string)
	if _, ifs := fx.A.Do("GET", devicePath(org, id)+"/interfaces", nil); len(ifs["interfaces"].([]any)) != int(c.PortCount) {
		t.Errorf("ports: %d, want %d", len(ifs["interfaces"].([]any)), c.PortCount)
	}
	if _, tpls := fx.A.Do("GET", orgPath(org)+"/device-templates", nil); len(tpls["templates"].([]any)) != 0 {
		t.Errorf("nothing is copied into the organization: %v", tpls["templates"])
	}
	if status, _ := fx.A.Do("POST", devicesPath(org), map[string]any{"hostname": "SW2", "type": "l2_switch", "siteId": site, "catalogId": "nope"}); status != http.StatusBadRequest {
		t.Errorf("unknown system template: %d", status)
	}
	// A device without ports takes the system template's ports.
	bare := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "SW3", "type": "l2_switch", "siteId": site}))
	if status, body := fx.A.Do("POST", devicePath(org, bare)+"/apply-template", map[string]any{"catalogId": c.Id}); status != http.StatusOK || body["added"] != float64(c.PortCount) {
		t.Errorf("apply system template: %d %v", status, body)
	}
}
