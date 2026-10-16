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
	_, unitB := mustPartnerUnit(t, fx.B, fx.OrgB, "FOOD")
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "FOOD-HN01", "name": "B", "businessUnitId": unitB}))
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
	siteA := idOf(t, mustCreate(t, fx.A, sitesPath(fx.OrgA), map[string]any{"code": "SHARED-HN01", "name": "A"}))
	_, unitA := mustPartnerUnit(t, fx.A, fx.OrgA, "AGRI")
	if status, _ := fx.A.Do("POST", devicesPath(fx.OrgA), map[string]any{"hostname": "A1", "type": "firewall", "siteId": siteA, "businessUnitId": unitA, "clusterId": clB}); status != http.StatusBadRequest {
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
	_, nm := mustPartnerUnit(t, fx.A, org, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "AGRI-BD01", "name": "BD", "businessUnitId": nm}))
	hn := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "AGRI-HN01", "name": "HN", "businessUnitId": nm}))
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
	if stack["mgmtIp"] != "10.72.114.5/24" || stack["businessUnitId"] != nm {
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
	if status, _ := fx.A.Do("PATCH", clustersPath(org)+"/"+stackID, map[string]any{"kind": "stack", "name": "BD-STACK", "siteId": hn, "version": 1}); status != http.StatusBadRequest {
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
	for action, want := range map[string]int{"cluster.create": 1, "cluster.delete": 1} {
		if got := auditCount(t, fx.Pool, action, org); got != want {
			t.Errorf("%s audit rows = %d, want %d", action, got, want)
		}
	}
}

// Concurrent creates of one hostname: exactly one wins (the advisory lock replaces the unique index).
func TestHostnameRuleUnderConcurrency(t *testing.T) {
	fx := newOrgFixture(t)
	_, nm := mustPartnerUnit(t, fx.A, fx.OrgA, "AGRI")
	bd := idOf(t, mustCreate(t, fx.A, sitesPath(fx.OrgA), map[string]any{"code": "AGRI-BD01", "name": "BD", "businessUnitId": nm}))
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
	w := newPermWorld(t)
	org := w.fx.OrgA
	if status, _ := w.ue.Do("POST", clustersPath(org), map[string]any{"kind": "ha_active_passive", "name": "NM-FW", "siteId": w.bd}); status != http.StatusCreated {
		t.Errorf("editor of NM creates a cluster: %d", status)
	}
	if status, _ := w.ue.Do("POST", clustersPath(org), map[string]any{"kind": "ha_active_passive", "name": "VP-FW", "siteId": w.hn}); status != http.StatusBadRequest {
		t.Errorf("editor of NM creates a cluster in VP's site: %d, want 400", status)
	}
	vp := idOf(t, mustCreate(t, w.fx.A, clustersPath(org), map[string]any{"kind": "stack", "name": "VP-STACK", "siteId": w.hn}))
	if status, _ := w.ue.Do("GET", clustersPath(org)+"/"+vp, nil); status != http.StatusNotFound {
		t.Errorf("editor of NM reads VP's cluster: %d, want 404", status)
	}
	if status, _ := w.uv.Do("PATCH", clustersPath(org)+"/"+vp, map[string]any{"kind": "stack", "name": "X", "siteId": w.hn, "version": 1}); status != http.StatusForbidden {
		t.Errorf("viewer of VP edits the cluster: %d, want 403", status)
	}
	_, list := w.ue.Do("GET", clustersPath(org), nil)
	if n := len(list["clusters"].([]any)); n != 1 {
		t.Errorf("editor of NM lists %d clusters, want 1", n)
	}
}
