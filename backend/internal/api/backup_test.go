package api

import (
	"context"
	"net/http"
	"testing"
)

// P2-13: only system admins see the backups; no good backup shows as stale; a failed run's error is shown.
func TestAdminBackups(t *testing.T) {
	fx := newOrgFixture(t)
	admin := fx.NewUser(t, "sysadmin-backup@example.com", true)
	if status, _ := fx.A.Do("GET", "/api/admin/backups", nil); status != http.StatusForbidden {
		t.Errorf("org owner reading backups: %d", status)
	}
	status, got := admin.Do("GET", "/api/admin/backups", nil)
	if status != http.StatusOK || got["stale"] != true || got["lastGood"] != nil || len(got["runs"].([]any)) != 0 {
		t.Fatalf("no backups yet: %d %v", status, got)
	}
	ctx := context.Background()
	if _, err := fx.Pool.Exec(ctx, `INSERT INTO backup_runs (kind, status, finished_at, file_name, size_bytes, verified_at)
		VALUES ('scheduled', 'ok', now(), 'ntb-a.ntbbak', 2048, now()), ('manual', 'failed', now(), '', 0, NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.Pool.Exec(ctx, `UPDATE backup_runs SET error = 'pg_dump: disk full', started_at = now() + interval '1 second' WHERE status = 'failed'`); err != nil {
		t.Fatal(err)
	}
	_, got = admin.Do("GET", "/api/admin/backups", nil)
	last, _ := got["lastGood"].(map[string]any)
	if got["stale"] != false || last == nil || last["fileName"] != "ntb-a.ntbbak" || last["verified"] != true {
		t.Errorf("after a good backup: %v", got)
	}
	if runs := got["runs"].([]any); len(runs) != 2 || runs[0].(map[string]any)["error"] != "pg_dump: disk full" {
		t.Errorf("runs: %v", runs)
	}
}
