package api

import (
	"context"
	"log/slog"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

// P1-25: the sample organization and a benchmark inventory are written through the normal handlers; the result is
// what the PLAN describes and passes the dashboard's org-wide checks.
func TestSeedDemoAndBench(t *testing.T) {
	fx := newOrgFixture(t)
	admin := fx.NewUser(t, "seed@example.vn", true)
	svc, err := auth.NewService(fx.Pool, testKeyring(t), slog.New(slog.DiscardHandler), cheapArgon)
	if err != nil {
		t.Fatalf("auth service: %v", err)
	}
	srv := NewServer(slog.New(slog.DiscardHandler), store.New(fx.Pool), fx.Pool, svc, "test", "testing")
	ctx := context.Background()

	if _, err := srv.SeedDemo(ctx, "a@example.vn"); err == nil {
		t.Error("seeding as a non system administrator must fail")
	}
	res, err := srv.SeedDemo(ctx, "seed@example.vn")
	if err != nil {
		t.Fatalf("seed demo: %v", err)
	}
	// IDC: Internet + 2 FortiGates; Food: 2 + 4; Agri: 6 routers; Văn phòng mẫu: Internet + FW + core + 3 switches.
	if res.Devices != 3+6+6+6 || len(res.Diagrams) != 2 {
		t.Errorf("demo: %+v", res)
	}
	if _, err := srv.SeedDemo(ctx, "seed@example.vn"); err == nil {
		t.Error("seeding twice must fail")
	}
	org := res.OrgID
	status, d := admin.Do("GET", dashboardPath(org), nil)
	if status != http.StatusOK {
		t.Fatalf("dashboard: %d %v", status, d)
	}
	if tot := d["totals"].(map[string]any); tot["devices"] != 21.0 || tot["errors"] != 0.0 || tot["warnings"] != 0.0 {
		t.Errorf("demo totals: %v problems %v", tot, d["problems"])
	}
	if sites := d["bySite"].([]any); len(sites) != 10 {
		t.Errorf("demo sites: %d", len(sites))
	}
	_, hits := admin.Do("GET", searchPath(org, "10.136.4.101"), nil)
	if ips := hits["ips"].([]any); len(ips) != 1 || ips[0].(map[string]any)["name"] != "FW-IDC" {
		t.Errorf("cluster VIP: %v", ips)
	}
	_, hits = admin.Do("GET", searchPath(org, "R-HY"), nil)
	if devs := hits["devices"].([]any); len(devs) != 1 || len(devs[0].(map[string]any)["diagrams"].([]any)) != 1 {
		t.Errorf("Agri router on the overview: %v", devs)
	}

	bench, err := srv.SeedBench(ctx, "seed@example.vn", 100)
	if err != nil {
		t.Fatalf("seed bench: %v", err)
	}
	// Sites of 40: 3 links for router/cores + 2 per access switch.
	if bench.Devices != 100 || bench.Links != 3*3+2*(100-9) {
		t.Errorf("bench: %+v", bench)
	}
	if bench.OrgID == uuid.Nil || bench.OrgID == org {
		t.Errorf("bench organization: %v", bench.OrgID)
	}
}
