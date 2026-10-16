package api

import (
	"net/http"
	"sync"
	"testing"

	"github.com/google/uuid"
)

func clustersPath(org uuid.UUID) string { return orgPath(org) + "/clusters" }

// Cross-tenant isolation for every cluster endpoint, plus joining another org's cluster.
func TestClusterEndpointsAreTenantIsolated(t *testing.T) {
	fx := newOrgFixture(t)
	unitB := mustCategory(t, fx.B, fx.OrgB, "FOOD")
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "HN01", "name": "B", "categoryId": unitB}))
	clB := idOf(t, mustCreate(t, fx.B, clustersPath(fx.OrgB), map[string]any{"kind": "ha_active_passive", "name": "FW-HA", "siteId": siteB}))
	cl := func(o uuid.UUID) string { return clustersPath(o) + "/" + clB }
	fx.AssertCrossTenantDenied(t, "GET", clustersPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", clustersPath, map[string]any{"kind": "stack", "name": "X", "siteId": siteB})
	fx.AssertCrossTenantDenied(t, "GET", cl, nil)
	for _, org := range []uuid.UUID{fx.OrgB, fx.OrgA} {
		for _, r := range []struct {
			method string
			body   map[string]any
		}{
			{"PATCH", map[string]any{"kind": "stack", "name": "HACK", "siteId": siteB, "version": 1}},
			{"DELETE", nil},
		} {
			if status, _ := fx.A.Do(r.method, cl(org), r.body); status != http.StatusNotFound {
				t.Errorf("A %s %s: %d, want 404", r.method, cl(org), status)
			}
		}
	}
	siteA := idOf(t, mustCreate(t, fx.A, sitesPath(fx.OrgA), map[string]any{"code": "HN01", "name": "A"}))
	if status, _ := fx.A.Do("POST", devicesPath(fx.OrgA), map[string]any{"hostname": "A1", "type": "firewall", "siteId": siteA, "clusterId": clB}); status != http.StatusBadRequest {
		t.Errorf("device into another org's cluster: %d, want 400", status)
	}
	if status, _ := fx.A.Do("POST", clustersPath(fx.OrgA), map[string]any{"kind": "stack", "name": "X", "siteId": siteB}); status != http.StatusBadRequest {
		t.Errorf("cluster in another org's site: %d, want 400", status)
	}
	if _, got := fx.B.Do("GET", cl(fx.OrgB), nil); got["name"] != "FW-HA" {
		t.Errorf("B's cluster changed: %v", got)
	}
}

func TestClusterMembersAndHostnameRule(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	nm := mustCategory(t, fx.A, org, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "BD01", "name": "BD", "categoryId": nm}))
	hn := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HN01", "name": "HN", "categoryId": nm}))
	for name, body := range map[string]map[string]any{
		"bad kind":     {"kind": "mesh", "name": "X", "siteId": bd},
		"bad IP":       {"kind": "stack", "name": "X", "siteId": bd, "mgmtIp": "10.1/24"},
		"bad hostname": {"kind": "stack", "name": "X", "siteId": bd, "hostname": "a b"},
	} {
		if status, _ := fx.A.Do("POST", clustersPath(org), body); status != http.StatusBadRequest {
			t.Errorf("cluster %s: %d, want 400", name, status)
		}
	}
	stack := mustCreate(t, fx.A, clustersPath(org), map[string]any{"kind": "stack", "name": "BD-STACK", "hostname": "BD-CORE", "mgmtIp": "10.72.114.5/24", "siteId": bd})
	if stack["mgmtIp"] != "10.72.114.5/24" || stack["categoryPath"] != "AGRI" {
		t.Errorf("cluster stored as %v", stack)
	}
	stackID := idOf(t, stack)
	if status, _ := fx.A.Do("POST", clustersPath(org), map[string]any{"kind": "stack", "name": "bd-stack", "siteId": bd}); status != http.StatusConflict {
		t.Errorf("duplicate cluster name: %d, want 409", status)
	}

	// Stack members may share a hostname; a device outside the cluster may not.
	member := func(no int) map[string]any {
		return map[string]any{"hostname": "BD-CORE", "type": "l3_switch", "siteId": bd, "clusterId": stackID, "clusterRole": "member", "clusterMemberNo": no}
	}
	m1 := idOf(t, mustCreate(t, fx.A, devicesPath(org), member(1)))
	m2 := mustCreate(t, fx.A, devicesPath(org), member(2))
	if m2["clusterName"] != "BD-STACK" || m2["clusterKind"] != "stack" || m2["clusterMemberNo"] != float64(2) {
		t.Errorf("member stored as %v", m2)
	}
	for name, c := range map[string]struct {
		body map[string]any
		want int
	}{
		"same hostname outside the cluster": {map[string]any{"hostname": "bd-core", "type": "router", "siteId": bd}, http.StatusConflict},
		"member number taken":               {member(2), http.StatusConflict},
		"member in another site":            {map[string]any{"hostname": "BD-CORE", "type": "l3_switch", "siteId": hn, "clusterId": stackID}, http.StatusBadRequest},
		"role without cluster":              {map[string]any{"hostname": "X1", "type": "router", "siteId": bd, "clusterRole": "primary", "clusterMemberNo": 1}, http.StatusCreated},
		"unknown cluster":                   {map[string]any{"hostname": "X2", "type": "router", "siteId": bd, "clusterId": uuid.NewString()}, http.StatusBadRequest},
	} {
		if status, body := fx.A.Do("POST", devicesPath(org), c.body); status != c.want {
			t.Errorf("%s: %d %v, want %d", name, status, body, c.want)
		}
	}
	// The device list filters by cluster and counts members per cluster.
	_, byCluster := fx.A.Do("GET", devicesPath(org)+"?clusterId="+stackID, nil)
	if byCluster["total"] != float64(2) || byCluster["facets"].(map[string]any)["cluster"].(map[string]any)[stackID] != float64(2) {
		t.Errorf("cluster filter: %v %v", byCluster["total"], byCluster["facets"])
	}
	// Kind ↔ device type (ADR-027): a camera does not stack; members share one type; "other" is open.
	if status, _ := fx.A.Do("POST", devicesPath(org), map[string]any{"hostname": "CAM-1", "type": "ip_camera", "siteId": bd, "clusterId": stackID}); status != http.StatusBadRequest {
		t.Errorf("camera into a stack: %d, want 400", status)
	}
	if status, _ := fx.A.Do("POST", devicesPath(org), map[string]any{"hostname": "SW-L2", "type": "l2_switch", "siteId": bd, "clusterId": stackID}); status != http.StatusBadRequest {
		t.Errorf("L2 switch into an L3 stack: %d, want 400", status)
	}
	other := idOf(t, mustCreate(t, fx.A, clustersPath(org), map[string]any{"kind": "other", "name": "CAM-PAIR", "siteId": bd}))
	mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "CAM-A", "type": "ip_camera", "siteId": bd, "clusterId": other})
	if status, _ := fx.A.Do("POST", devicesPath(org), map[string]any{"hostname": "NVR-A", "type": "nvr", "siteId": bd, "clusterId": other}); status != http.StatusBadRequest {
		t.Errorf("mixed types in an 'other' cluster: %d, want 400", status)
	}
	if status, _ := fx.A.Do("PATCH", clustersPath(org)+"/"+stackID, map[string]any{"kind": "ha_active_passive", "name": "BD-STACK", "siteId": bd, "version": 1}); status != http.StatusBadRequest {
		t.Errorf("switch stack turned into HA: %d, want 400", status)
	}
	if status, _ := fx.A.Do("PATCH", clustersPath(org)+"/"+stackID, map[string]any{"kind": "vss", "name": "BD-STACK", "siteId": bd, "version": 1}); status != http.StatusOK {
		t.Errorf("L3 stack turned into VSS: %d", status)
	}
	// The role is dropped when no cluster is set.
	_, x1 := fx.A.Do("GET", devicesPath(org)+"?q=X1", nil)
	if d := x1["devices"].([]any)[0].(map[string]any); d["clusterRole"] != nil || d["clusterMemberNo"] != nil {
		t.Errorf("role kept without a cluster: %v", d)
	}
	// Leaving the cluster while sharing its hostname is refused; renamed first, it works.
	_, cur := fx.A.Do("GET", devicesPath(org)+"/"+m1, nil)
	leave := map[string]any{"hostname": "BD-CORE", "type": "l3_switch", "siteId": bd, "version": cur["version"]}
	if status, _ := fx.A.Do("PATCH", devicesPath(org)+"/"+m1, leave); status != http.StatusConflict {
		t.Errorf("leave the cluster keeping the shared hostname: %d, want 409", status)
	}
	leave["hostname"] = "BD-CORE-1"
	if status, body := fx.A.Do("PATCH", devicesPath(org)+"/"+m1, leave); status != http.StatusOK || body["clusterId"] != nil {
		t.Errorf("leave the cluster renamed: %d %v", status, body)
	}
	// Cluster detail lists its members; site cannot change while it has members; delete only when empty.
	_, detail := fx.A.Do("GET", clustersPath(org)+"/"+stackID, nil)
	if detail["memberCount"] != float64(1) || len(detail["members"].([]any)) != 1 {
		t.Errorf("cluster detail: %v", detail)
	}
	if status, _ := fx.A.Do("PATCH", clustersPath(org)+"/"+stackID, map[string]any{"kind": "stack", "name": "BD-STACK", "siteId": hn, "version": 2}); status != http.StatusBadRequest {
		t.Errorf("move a cluster with members: %d, want 400", status)
	}
	if status, _ := fx.A.Do("DELETE", clustersPath(org)+"/"+stackID, nil); status != http.StatusConflict {
		t.Errorf("delete a cluster with members: %d, want 409", status)
	}
	m2ID := idOf(t, m2)
	_, cur2 := fx.A.Do("GET", devicesPath(org)+"/"+m2ID, nil)
	if status, _ := fx.A.Do("PATCH", devicesPath(org)+"/"+m2ID, map[string]any{"hostname": "BD-CORE", "type": "l3_switch", "siteId": bd, "version": cur2["version"]}); status != http.StatusOK {
		t.Errorf("last member leaves (hostname now unique): %d", status)
	}
	if status, _ := fx.A.Do("DELETE", clustersPath(org)+"/"+stackID, nil); status != http.StatusNoContent {
		t.Errorf("delete the empty cluster: %d", status)
	}
	for action, want := range map[string]int{"cluster.create": 2, "cluster.update": 1, "cluster.delete": 1} {
		if got := auditCount(t, fx.Pool, action, org); got != want {
			t.Errorf("%s audit rows = %d, want %d", action, got, want)
		}
	}
}

// Concurrent creates of one hostname: exactly one wins (the advisory lock replaces the unique index).
func TestHostnameRuleUnderConcurrency(t *testing.T) {
	fx := newOrgFixture(t)
	nm := mustCategory(t, fx.A, fx.OrgA, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(fx.OrgA), map[string]any{"code": "BD01", "name": "BD", "categoryId": nm}))
	var wg sync.WaitGroup
	codes := make([]int, 8)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes[i], _ = fx.A.Do("POST", devicesPath(fx.OrgA), map[string]any{"hostname": "RACE-01", "type": "router", "siteId": bd})
		}(i)
	}
	wg.Wait()
	created := 0
	for _, c := range codes {
		if c == http.StatusCreated {
			created++
		}
	}
	if created != 1 {
		t.Errorf("concurrent creates: %v, want exactly one 201", codes)
	}
}

func TestClusterPermissions(t *testing.T) {
	w := newRoleWorld(t)
	org := w.fx.OrgA
	if status, _ := w.editor.Do("POST", clustersPath(org), map[string]any{"kind": "ha_active_passive", "name": "BD-FW", "siteId": w.site}); status != http.StatusCreated {
		t.Errorf("editor creates a cluster: %d", status)
	}
	id := idOf(t, mustCreate(t, w.fx.A, clustersPath(org), map[string]any{"kind": "stack", "name": "HN-STACK", "siteId": w.other}))
	if status, c := w.viewer.Do("GET", clustersPath(org)+"/"+id, nil); status != http.StatusOK || c["access"] != "view" {
		t.Errorf("viewer reads a cluster: %d", status)
	}
	if status, _ := w.viewer.Do("PATCH", clustersPath(org)+"/"+id, map[string]any{"kind": "stack", "name": "X", "siteId": w.other, "version": 1}); status != http.StatusForbidden {
		t.Errorf("viewer edits a cluster: %d, want 403", status)
	}
	if _, list := w.viewer.Do("GET", clustersPath(org), nil); len(list["clusters"].([]any)) != 2 {
		t.Errorf("viewer lists %v", list)
	}
}
