package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/catalog"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

// libraryModelWithDates is a catalog model with both vendor milestones (the data ships some, ADR-041 / P2-22).
func libraryModelWithDates(t *testing.T) apigen.CatalogModel {
	t.Helper()
	for _, c := range catalog.All() {
		if c.Lifecycle.EndOfSale != "" && c.Lifecycle.EndOfSupport != "" {
			return c
		}
	}
	t.Fatal("no catalog model has end-of-sale and end-of-support dates")
	return apigen.CatalogModel{}
}

// P2-22: a new device takes the library's dates unless it was given its own.
func TestDeviceLifecycleFromLibrary(t *testing.T) {
	c := libraryModelWithDates(t)
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))

	_, dev := fx.A.Do("POST", devicesPath(org), map[string]any{"hostname": "SW1", "type": string(c.Type), "siteId": site, "catalogId": c.Id})
	if dev["eolDate"] != c.Lifecycle.EndOfSale || dev["eosDate"] != c.Lifecycle.EndOfSupport {
		t.Errorf("from catalog: eol %v eos %v, want %s %s", dev["eolDate"], dev["eosDate"], c.Lifecycle.EndOfSale, c.Lifecycle.EndOfSupport)
	}
	// Named by model only, with a date of its own: that date stays, the empty one is filled.
	_, dev = fx.A.Do("POST", devicesPath(org), map[string]any{"hostname": "SW2", "type": string(c.Type), "siteId": site,
		"model": c.Model, "eosDate": "2040-01-01"})
	if dev["eolDate"] != c.Lifecycle.EndOfSale || dev["eosDate"] != "2040-01-01" {
		t.Errorf("by model: eol %v eos %v", dev["eolDate"], dev["eosDate"])
	}
	// Unknown model: nothing to take.
	if _, dev = fx.A.Do("POST", devicesPath(org), map[string]any{"hostname": "SW3", "type": "l2_switch", "siteId": site, "model": "No Such 9000"}); dev["eosDate"] != nil {
		t.Errorf("unknown model got a date: %v", dev["eosDate"])
	}
}

// P2-22: devices already in the inventory get the library's dates for their empty fields — preview, then apply;
// never over a typed date, only devices the caller may edit, audited, tenant-scoped.
func TestFillDeviceLifecycle(t *testing.T) {
	c := libraryModelWithDates(t)
	fx := newOrgFixture(t)
	org := fx.OrgA
	path := func(o uuid.UUID) string { return orgPath(o) + "/devices/fill-lifecycle" }
	fx.AssertCrossTenantDenied(t, "POST", path, map[string]any{"apply": false})

	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))
	// Created under another model, then renamed to the library model: its dates are still empty.
	old := mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "OLD1", "type": string(c.Type), "siteId": site, "model": "Legacy"})
	kept := mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "OLD2", "type": string(c.Type), "siteId": site,
		"model": "Legacy", "eosDate": "2040-01-01"})
	for _, d := range []map[string]any{old, kept} {
		d["model"] = c.Model
		if status, got := fx.A.Do("PATCH", devicePath(org, d["id"].(string)), d); status != http.StatusOK || got["eolDate"] != nil {
			t.Fatalf("rename: %d %v", status, got)
		}
	}

	status, preview := fx.A.Do("POST", path(org), map[string]any{"apply": false})
	rows, _ := preview["devices"].([]any)
	if status != http.StatusOK || preview["applied"] != false || len(rows) != 2 {
		t.Fatalf("preview: %d %v", status, preview)
	}
	if _, got := fx.A.Do("GET", devicePath(org, old["id"].(string)), nil); got["eolDate"] != nil {
		t.Errorf("preview wrote: %v", got["eolDate"])
	}
	// A viewer sees nothing to fill and changes nothing.
	viewer := fx.NewUser(t, "viewer-eol@example.com", false, tenanttest.Member{Org: org, Role: "viewer"})
	if status, got := viewer.Do("POST", path(org), map[string]any{"apply": true}); status != http.StatusOK || len(got["devices"].([]any)) != 0 {
		t.Errorf("viewer: %d %v", status, got)
	}

	before := auditCount(t, fx.Pool, "device.update", org)
	if status, done := fx.A.Do("POST", path(org), map[string]any{"apply": true}); status != http.StatusOK || done["applied"] != true || len(done["devices"].([]any)) != 2 {
		t.Fatalf("apply: %d %v", status, done)
	}
	if got := auditCount(t, fx.Pool, "device.update", org) - before; got != 2 {
		t.Errorf("audit entries: %d", got)
	}
	_, a := fx.A.Do("GET", devicePath(org, old["id"].(string)), nil)
	_, b := fx.A.Do("GET", devicePath(org, kept["id"].(string)), nil)
	if a["eolDate"] != c.Lifecycle.EndOfSale || a["eosDate"] != c.Lifecycle.EndOfSupport {
		t.Errorf("filled: %v %v", a["eolDate"], a["eosDate"])
	}
	if b["eolDate"] != c.Lifecycle.EndOfSale || b["eosDate"] != "2040-01-01" {
		t.Errorf("typed date must stay: %v %v", b["eolDate"], b["eosDate"])
	}
	if _, again := fx.A.Do("POST", path(org), map[string]any{"apply": false}); len(again["devices"].([]any)) != 0 {
		t.Errorf("nothing left to fill: %v", again)
	}

	// Made from the library model, renamed to an unknown one before its dates were set: the old model's dates do not
	// follow it.
	moved := mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "MOVED", "type": string(c.Type), "siteId": site,
		"catalogId": c.Id, "eolDate": "2039-01-01", "eosDate": "2040-01-01"})
	moved["model"], moved["partNumber"], moved["eolDate"], moved["eosDate"] = "Other 1", "", nil, nil
	if status, got := fx.A.Do("PATCH", devicePath(org, moved["id"].(string)), moved); status != http.StatusOK {
		t.Fatalf("rename moved: %d %v", status, got)
	}
	if _, again := fx.A.Do("POST", path(org), map[string]any{"apply": false}); len(again["devices"].([]any)) != 0 {
		t.Errorf("a renamed device keeps the old model's dates: %v", again)
	}
}

// P2-22: the device list filters on vendor end-of-support — already past, or within 12 months.
func TestDeviceSupportFilter(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))
	today := calendarToday()
	for host, eos := range map[string]string{
		"PAST": today.AddDate(0, 0, -1).Format("2006-01-02"),
		"SOON": today.AddDate(0, 6, 0).Format("2006-01-02"),
		"LATE": today.AddDate(3, 0, 0).Format("2006-01-02"),
	} {
		mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": host, "type": "l2_switch", "siteId": site, "model": "No Such 9000", "eosDate": eos})
	}
	mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "NONE", "type": "l2_switch", "siteId": site, "model": "No Such 9000"})
	// Retired: out of the support report, like the dashboard.
	mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "GONE", "type": "l2_switch", "siteId": site, "model": "No Such 9000",
		"lifecycle": "retired", "eosDate": today.AddDate(-1, 0, 0).Format("2006-01-02")})
	names := func(q string) []string {
		status, got := fx.A.Do("GET", devicesPath(org)+q, nil)
		if status != http.StatusOK {
			t.Fatalf("%s: %d %v", q, status, got)
		}
		out := []string{}
		for _, d := range got["devices"].([]any) {
			out = append(out, d.(map[string]any)["hostname"].(string))
		}
		if int(got["total"].(float64)) != len(out) {
			t.Errorf("%s: total %v for %d rows", q, got["total"], len(out))
		}
		return out
	}
	if got := names("?support=expired"); len(got) != 1 || got[0] != "PAST" {
		t.Errorf("expired: %v", got)
	}
	if got := names("?support=soon"); len(got) != 1 || got[0] != "SOON" {
		t.Errorf("soon: %v", got)
	}
	if got := names(""); len(got) != 5 {
		t.Errorf("unfiltered: %v", got)
	}
	if status, _ := fx.A.Do("GET", devicesPath(org)+"?support=later", nil); status != http.StatusBadRequest {
		t.Errorf("bad filter: %d", status)
	}
}
