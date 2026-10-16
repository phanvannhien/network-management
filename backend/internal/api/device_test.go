package api

import (
	"net/http"
	"net/url"
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func devicesPath(org uuid.UUID) string { return orgPath(org) + "/devices" }
func fieldsPath(org uuid.UUID) string  { return orgPath(org) + "/custom-fields" }

func hostnamesOf(t *testing.T, body map[string]any) []string {
	t.Helper()
	out := []string{}
	for _, d := range body["devices"].([]any) {
		out = append(out, d.(map[string]any)["hostname"].(string))
	}
	return out
}

func listDevices(t *testing.T, c *tenanttest.Client, org uuid.UUID, q url.Values) map[string]any {
	t.Helper()
	status, body := c.Do("GET", devicesPath(org)+"?"+q.Encode(), nil)
	if status != http.StatusOK {
		t.Fatalf("list devices %v: %d %v", q, status, body)
	}
	return body
}

// Cross-tenant isolation for every device and custom-field endpoint, plus placing a device in another org.
func TestDeviceEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	unitB := mustCategory(t, fx.B, fx.OrgB, "FOOD")
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "HN01", "name": "B", "categoryId": unitB}))
	devB := idOf(t, mustCreate(t, fx.B, devicesPath(fx.OrgB), map[string]any{"hostname": "B-FW01", "type": "firewall", "siteId": siteB}))
	fieldB := idOf(t, mustCreate(t, fx.B, fieldsPath(fx.OrgB), map[string]any{"key": "cost", "label": "Cost", "kind": "number"}))
	dev := func(o uuid.UUID) string { return devicesPath(o) + "/" + devB }
	field := func(o uuid.UUID) string { return fieldsPath(o) + "/" + fieldB }

	for _, c := range []struct {
		method string
		path   func(uuid.UUID) string
		body   any
	}{
		{"GET", devicesPath, nil},
		{"POST", devicesPath, map[string]any{"hostname": "X1", "type": "router", "siteId": siteB}},
		{"GET", dev, nil},
		{"GET", func(o uuid.UUID) string { return dev(o) + "/history" }, nil},
		{"POST", func(o uuid.UUID) string { return devicesPath(o) + "/bulk-update" }, map[string]any{"ids": []string{devB}, "lifecycle": "active"}},
		{"GET", fieldsPath, nil},
		{"POST", fieldsPath, map[string]any{"key": "x", "label": "X", "kind": "text"}},
	} {
		fx.AssertCrossTenantDenied(t, c.method, c.path, c.body)
	}
	for _, org := range []uuid.UUID{fx.OrgB, fx.OrgA} {
		for _, r := range []struct {
			method, path string
			body         map[string]any
		}{
			{"PATCH", dev(org), map[string]any{"hostname": "HACK", "type": "router", "siteId": siteB, "version": 1}},
			{"DELETE", dev(org), nil},
			{"POST", devicesPath(org) + "/bulk-delete", map[string]any{"ids": []string{devB}}},
			{"PATCH", field(org), map[string]any{"label": "x", "version": 1}},
			{"DELETE", field(org), nil},
		} {
			if org == fx.OrgB && r.path == devicesPath(org)+"/bulk-delete" {
				continue // tenancy already denies OrgB as a whole; keep B's device for the checks below
			}
			if status, _ := fx.A.Do(r.method, r.path, r.body); status != http.StatusNotFound {
				t.Errorf("A %s %s: %d, want 404", r.method, r.path, status)
			}
		}
	}
	// A cannot put a device in B's site, nor count B's devices.
	if status, _ := fx.A.Do("POST", devicesPath(fx.OrgA), map[string]any{"hostname": "A1", "type": "router", "siteId": siteB}); status != http.StatusBadRequest {
		t.Errorf("device in another org's site: %d, want 400", status)
	}
	if got := listDevices(t, fx.A, fx.OrgA, url.Values{})["total"]; got != float64(0) {
		t.Errorf("A sees %v devices", got)
	}
	_, got := fx.B.Do("GET", dev(fx.OrgB), nil)
	if got["hostname"] != "B-FW01" || got["lifecycle"] != "active" {
		t.Errorf("B's device changed: %v", got)
	}
	if _, f := fx.B.Do("GET", fieldsPath(fx.OrgB), nil); f["fields"].([]any)[0].(map[string]any)["label"] != "Cost" {
		t.Errorf("B's field changed: %v", f)
	}
}

func TestDeviceRules(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	nm := mustCategory(t, fx.A, org, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "BD", "categoryId": nm}))
	idc := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "IDC"}))
	room := idOf(t, mustCreate(t, fx.A, sitesPath(org)+"/"+bd+"/locations", map[string]any{"kind": "room", "name": "Phòng máy"}))
	rack := idOf(t, mustCreate(t, fx.A, sitesPath(org)+"/"+bd+"/racks", map[string]any{"locationId": room, "name": "R1", "uHeight": 10}))
	idcRoom := idOf(t, mustCreate(t, fx.A, sitesPath(org)+"/"+idc+"/locations", map[string]any{"kind": "room", "name": "IDC room"}))
	mustCreate(t, fx.A, fieldsPath(org), map[string]any{"key": "cost_center", "label": "Cost center", "kind": "select", "options": []string{"IT", "OT"}, "required": true})
	mustCreate(t, fx.A, fieldsPath(org), map[string]any{"key": "bought", "label": "Bought", "kind": "date"})
	cf := map[string]any{"cost_center": "IT"}

	fw := mustCreate(t, fx.A, devicesPath(org), map[string]any{
		"hostname": "AGRI-BD-FW01", "type": "firewall", "siteId": bd, "rackId": rack, "rackU": 9, "uHeight": 1,
		"vendor": "Fortinet", "tags": []string{"edge", "Edge", " ha "}, "customFields": cf, "warrantyEnd": "2027-06-30",
	})
	if fw["categoryId"] != nm || fw["categoryPath"] != "AGRI" || fw["siteCode"] != "ORG-AGRI-BD01" || fw["locationId"] != room || !slices.Equal(anyStrings(fw["tags"]), []string{"edge", "ha"}) {
		t.Errorf("device stored as %v", fw)
	}
	for name, c := range map[string]struct {
		body map[string]any
		want int
	}{
		"duplicate hostname (case)":     {map[string]any{"hostname": "agri-bd-fw01", "type": "router", "siteId": bd, "customFields": cf}, http.StatusConflict},
		"bad hostname":                  {map[string]any{"hostname": "a b", "type": "router", "siteId": bd, "customFields": cf}, http.StatusBadRequest},
		"bad type":                      {map[string]any{"hostname": "X1", "type": "toaster", "siteId": bd, "customFields": cf}, http.StatusBadRequest},
		"unknown site":                  {map[string]any{"hostname": "X2", "type": "router", "siteId": uuid.NewString(), "customFields": cf}, http.StatusBadRequest},
		"location of another site":      {map[string]any{"hostname": "X4", "type": "router", "siteId": bd, "locationId": idcRoom, "customFields": cf}, http.StatusBadRequest},
		"rack U overlap":                {map[string]any{"hostname": "X5", "type": "router", "siteId": bd, "rackId": rack, "rackU": 9, "customFields": cf}, http.StatusBadRequest},
		"rack too small":                {map[string]any{"hostname": "X6", "type": "router", "siteId": bd, "rackId": rack, "rackU": 9, "uHeight": 3, "customFields": cf}, http.StatusBadRequest},
		"U without rack":                {map[string]any{"hostname": "X7", "type": "router", "siteId": bd, "rackU": 3, "customFields": cf}, http.StatusBadRequest},
		"unknown custom field":          {map[string]any{"hostname": "X8", "type": "router", "siteId": bd, "customFields": map[string]any{"cost_center": "IT", "nope": 1}}, http.StatusBadRequest},
		"required custom field missing": {map[string]any{"hostname": "X9", "type": "router", "siteId": bd}, http.StatusBadRequest},
		"select value not an option":    {map[string]any{"hostname": "X10", "type": "router", "siteId": bd, "customFields": map[string]any{"cost_center": "HR"}}, http.StatusBadRequest},
		"bad date value":                {map[string]any{"hostname": "X11", "type": "router", "siteId": bd, "customFields": map[string]any{"cost_center": "IT", "bought": "30/06/2027"}}, http.StatusBadRequest},
		"shared site with unit":         {map[string]any{"hostname": "FOOD-IDC-SW01", "type": "l3_switch", "siteId": idc, "locationId": idcRoom, "customFields": cf, "lifecycle": "spare"}, http.StatusCreated},
		"rack slot right below":         {map[string]any{"hostname": "AGRI-BD-SW01", "type": "l2_switch", "siteId": bd, "rackId": rack, "rackU": 7, "uHeight": 2, "customFields": cf, "tags": []string{"access"}}, http.StatusCreated},
	} {
		if status, body := fx.A.Do("POST", devicesPath(org), c.body); status != c.want {
			t.Errorf("%s: %d %v, want %d", name, status, body, c.want)
		}
	}

	// Update: optimistic lock, history, the rack moves with the location rule.
	fwID := idOf(t, fw)
	upd := map[string]any{"hostname": "AGRI-BD-FW01", "type": "firewall", "siteId": bd, "rackId": rack, "rackU": 10, "customFields": cf, "lifecycle": "rma", "version": 1}
	if status, body := fx.A.Do("PATCH", devicesPath(org)+"/"+fwID, upd); status != http.StatusOK || body["lifecycle"] != "rma" || body["rackU"] != float64(10) {
		t.Fatalf("update: %d %v", status, body)
	}
	if status, _ := fx.A.Do("PATCH", devicesPath(org)+"/"+fwID, upd); status != http.StatusConflict {
		t.Errorf("stale update: %d, want 409", status)
	}
	_, hist := fx.A.Do("GET", devicesPath(org)+"/"+fwID+"/history", nil)
	if e := hist["entries"].([]any); len(e) != 2 || e[0].(map[string]any)["action"] != "device.update" || e[0].(map[string]any)["before"].(map[string]any)["lifecycle"] != "active" {
		t.Errorf("history: %v", hist)
	}

	// Deleting containers that hold devices is refused.
	for name, path := range map[string]string{
		"rack":     sitesPath(org) + "/" + bd + "/racks/" + rack,
		"location": sitesPath(org) + "/" + idc + "/locations/" + idcRoom,
		"site":     sitesPath(org) + "/" + bd,
	} {
		if status, body := fx.A.Do("DELETE", path, nil); status != http.StatusConflict {
			t.Errorf("delete %s with devices: %d %v, want 409", name, status, body)
		}
	}
	if status, _ := fx.A.Do("DELETE", devicesPath(org)+"/"+fwID, nil); status != http.StatusNoContent {
		t.Fatalf("delete device: %d", status)
	}
	if status, _ := fx.A.Do("GET", devicesPath(org)+"/"+fwID, nil); status != http.StatusNotFound {
		t.Errorf("deleted device still readable: %d", status)
	}
	// The hostname is free again once the device is deleted.
	mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "AGRI-BD-FW01", "type": "firewall", "siteId": bd, "customFields": cf})
	for action, want := range map[string]int{"device.create": 4, "device.update": 1, "device.delete": 1, "custom_field.create": 2} {
		if got := auditCount(t, fx.Pool, action, org); got != want {
			t.Errorf("%s audit rows = %d, want %d", action, got, want)
		}
	}
}

func anyStrings(v any) []string {
	out := []string{}
	for _, s := range v.([]any) {
		out = append(out, s.(string))
	}
	return out
}

func TestDeviceListFiltersSortsAndPages(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	nm := mustCategory(t, fx.A, org, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "BD", "categoryId": nm}))
	hn := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HN01", "name": "HN", "categoryId": nm}))
	for _, d := range []map[string]any{
		{"hostname": "BD-FW01", "type": "firewall", "siteId": bd, "vendor": "Fortinet", "serialNumber": "FGT60F0001", "tags": []string{"edge"}},
		{"hostname": "BD-SW01", "type": "l2_switch", "siteId": bd, "vendor": "Cisco", "lifecycle": "spare", "warrantyEnd": "2026-01-01"},
		{"hostname": "BD-SW02", "type": "l2_switch", "siteId": bd, "vendor": "Cisco", "tags": []string{"edge", "poe"}, "warrantyEnd": "2028-01-01"},
		{"hostname": "HN-AP01", "type": "access_point", "siteId": hn, "vendor": "Aruba"},
		{"hostname": "HN-SW01", "type": "l2_switch", "siteId": hn, "vendor": "Cisco", "lifecycle": "retired"},
	} {
		mustCreate(t, fx.A, devicesPath(org), d)
	}
	for name, c := range map[string]struct {
		q    url.Values
		want []string
	}{
		"all, by hostname":         {url.Values{}, []string{"BD-FW01", "BD-SW01", "BD-SW02", "HN-AP01", "HN-SW01"}},
		"type":                     {url.Values{"type": {"l2_switch"}}, []string{"BD-SW01", "BD-SW02", "HN-SW01"}},
		"type and lifecycle":       {url.Values{"type": {"l2_switch"}, "lifecycle": {"active", "spare"}}, []string{"BD-SW01", "BD-SW02"}},
		"site":                     {url.Values{"siteId": {hn}}, []string{"HN-AP01", "HN-SW01"}},
		"tag (any of)":             {url.Values{"tag": {"poe", "edge"}}, []string{"BD-FW01", "BD-SW02"}},
		"search serial":            {url.Values{"q": {"fgt60f"}}, []string{"BD-FW01"}},
		"search is not a pattern":  {url.Values{"q": {"%"}}, []string{}},
		"hostname desc":            {url.Values{"sort": {"hostname"}, "desc": {"true"}}, []string{"HN-SW01", "HN-AP01", "BD-SW02", "BD-SW01", "BD-FW01"}},
		"warranty asc, nulls last": {url.Values{"sort": {"warrantyEnd"}}, []string{"BD-SW01", "BD-SW02", "BD-FW01", "HN-AP01", "HN-SW01"}},
		"page 2 of 2":              {url.Values{"page": {"2"}, "pageSize": {"3"}}, []string{"HN-AP01", "HN-SW01"}},
	} {
		body := listDevices(t, fx.A, org, c.q)
		if got := hostnamesOf(t, body); !slices.Equal(got, c.want) {
			t.Errorf("%s: %v, want %v", name, got, c.want)
		}
	}
	// Total counts the whole result; facet counts ignore their own facet.
	body := listDevices(t, fx.A, org, url.Values{"type": {"l2_switch"}, "pageSize": {"1"}})
	facets := body["facets"].(map[string]any)
	if body["total"] != float64(3) || facets["type"].(map[string]any)["firewall"] != float64(1) ||
		facets["site"].(map[string]any)[bd] != float64(2) || facets["vendor"].(map[string]any)["Cisco"] != float64(3) {
		t.Errorf("total / facets: %v %v", body["total"], facets)
	}
	if status, _ := fx.A.Do("GET", devicesPath(org)+"?pageSize=500", nil); status != http.StatusBadRequest {
		t.Errorf("pageSize 500: %d, want 400", status)
	}
	if status, _ := fx.A.Do("GET", devicesPath(org)+"?sort=password", nil); status != http.StatusBadRequest {
		t.Errorf("bad sort: %d, want 400", status)
	}
}

// ADR-032: every member sees the whole organization; viewers only read; bulk changes are all or nothing.
func TestDevicePermissionsAndBulk(t *testing.T) {
	w := newRoleWorld(t)
	org := w.fx.OrgA
	a := idOf(t, mustCreate(t, w.fx.A, devicesPath(org), map[string]any{"hostname": "BD-SW01", "type": "l2_switch", "siteId": w.site}))
	b := idOf(t, mustCreate(t, w.fx.A, devicesPath(org), map[string]any{"hostname": "HN-SW01", "type": "l2_switch", "siteId": w.other}))
	if got := hostnamesOf(t, listDevices(t, w.viewer, org, url.Values{})); !slices.Equal(got, []string{"BD-SW01", "HN-SW01"}) {
		t.Errorf("viewer sees %v", got)
	}
	if _, d := w.viewer.Do("GET", devicesPath(org)+"/"+a, nil); d["access"] != "view" {
		t.Errorf("viewer access: %v", d["access"])
	}
	for _, r := range []struct {
		method, path string
		body         map[string]any
	}{
		{"POST", devicesPath(org), map[string]any{"hostname": "X", "type": "router", "siteId": w.site}},
		{"PATCH", devicesPath(org) + "/" + a, map[string]any{"hostname": "BD-SW01", "type": "router", "siteId": w.site, "version": 1}},
		{"DELETE", devicesPath(org) + "/" + a, nil},
		{"POST", devicesPath(org) + "/bulk-update", map[string]any{"ids": []string{a}, "lifecycle": "spare"}},
		{"POST", devicesPath(org) + "/bulk-delete", map[string]any{"ids": []string{a}}},
	} {
		if status, _ := w.viewer.Do(r.method, r.path, r.body); status != http.StatusForbidden {
			t.Errorf("viewer %s %s: %d, want 403", r.method, r.path, status)
		}
	}
	bulk := devicesPath(org) + "/bulk-update"
	if status, _ := w.editor.Do("POST", bulk, map[string]any{"ids": []string{a, uuid.NewString()}, "lifecycle": "spare"}); status != http.StatusNotFound {
		t.Errorf("bulk with an unknown device: %d, want 404", status)
	}
	if status, body := w.editor.Do("POST", bulk, map[string]any{"ids": []string{a, b, a}, "lifecycle": "spare", "addTags": []string{"audit-2026"}, "ownerName": "Phạm Hùng"}); status != http.StatusOK || body["count"] != float64(2) {
		t.Fatalf("bulk update: %d %v", status, body)
	}
	_, got := w.editor.Do("GET", devicesPath(org)+"/"+b, nil)
	if got["lifecycle"] != "spare" || got["ownerName"] != "Phạm Hùng" || !slices.Contains(anyStrings(got["tags"]), "audit-2026") {
		t.Errorf("after bulk: %v", got)
	}
	if status, _ := w.editor.Do("POST", bulk, map[string]any{"ids": []string{b}, "removeTags": []string{"AUDIT-2026"}}); status != http.StatusOK {
		t.Errorf("bulk remove tag: %d", status)
	}
	if _, got := w.editor.Do("GET", devicesPath(org)+"/"+b, nil); len(got["tags"].([]any)) != 0 {
		t.Errorf("tag not removed: %v", got["tags"])
	}
	if status, _ := w.editor.Do("POST", devicesPath(org)+"/bulk-delete", map[string]any{"ids": []string{a, uuid.NewString()}}); status != http.StatusNotFound {
		t.Errorf("bulk delete with an unknown device: %d, want 404", status)
	}
	if _, got := w.editor.Do("GET", devicesPath(org)+"/"+a, nil); got["hostname"] != "BD-SW01" {
		t.Errorf("all-or-nothing delete removed BD-SW01: %v", got)
	}
	if status, body := w.editor.Do("POST", devicesPath(org)+"/bulk-delete", map[string]any{"ids": []string{a, b}}); status != http.StatusOK || body["count"] != float64(2) {
		t.Errorf("bulk delete: %d %v", status, body)
	}
}

func TestCustomFieldRules(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	editor := fx.NewUser(t, "ed@example.com", false, tenanttest.Member{Org: org, Role: "editor"})
	if status, _ := editor.Do("POST", fieldsPath(org), map[string]any{"key": "x", "label": "X", "kind": "text"}); status != http.StatusForbidden {
		t.Errorf("editor declares a field: %d, want 403", status)
	}
	for name, body := range map[string]map[string]any{
		"bad key":            {"key": "Bad Key", "label": "X", "kind": "text"},
		"select, no options": {"key": "a", "label": "A", "kind": "select"},
		"options on text":    {"key": "b", "label": "B", "kind": "text", "options": []string{"x"}},
		"unknown kind":       {"key": "c", "label": "C", "kind": "color"},
	} {
		if status, _ := fx.A.Do("POST", fieldsPath(org), body); status != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", name, status)
		}
	}
	f := mustCreate(t, fx.A, fieldsPath(org), map[string]any{"key": "zone", "label": "Zone", "kind": "select", "options": []string{"A", "B", "A", " "}})
	if !slices.Equal(anyStrings(f["options"]), []string{"A", "B"}) {
		t.Errorf("options = %v", f["options"])
	}
	if status, _ := fx.A.Do("POST", fieldsPath(org), map[string]any{"key": "zone", "label": "Z2", "kind": "text"}); status != http.StatusConflict {
		t.Errorf("duplicate key: %d, want 409", status)
	}
	if status, body := fx.A.Do("PATCH", fieldsPath(org)+"/"+idOf(t, f), map[string]any{"label": "Khu vực", "options": []string{"A", "B", "C"}, "version": 1}); status != http.StatusOK || body["label"] != "Khu vực" || body["key"] != "zone" {
		t.Errorf("update field: %d %v", status, body)
	}
	if status, _ := editor.Do("GET", fieldsPath(org), nil); status != http.StatusOK {
		t.Errorf("editor reads fields: %d", status)
	}
	if status, _ := fx.A.Do("DELETE", fieldsPath(org)+"/"+idOf(t, f), nil); status != http.StatusNoContent {
		t.Errorf("delete field: %d", status)
	}
}
