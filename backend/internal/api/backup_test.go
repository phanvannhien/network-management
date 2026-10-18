package api

import (
	"bytes"
	"context"
	"net/http"
	"strings"
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

// P2-13 step 2: destinations — only system admins; secrets sealed, never returned nor audited; omitted secret
// kept; kind fixed; stale version refused; a backup download needs MFA; backups off = no run.
func TestAdminBackupTargets(t *testing.T) {
	fx := newOrgFixture(t)
	admin := fx.NewUser(t, "sysadmin-targets@example.com", true)
	path := "/api/admin/backup-targets"
	body := map[string]any{"name": "NAS văn phòng", "kind": "sftp", "enabled": true, "keep": "7,4,12",
		"settings": map[string]any{"host": "nas.local", "port": 22, "user": "backup", "path": "ntb", "hostKey": "nas.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5"}, "password": "nas-secret-pw"}
	if status, _ := fx.A.Do("POST", path, body); status != http.StatusForbidden {
		t.Errorf("org owner adding a destination: %d", status)
	}
	status, got := admin.Do("POST", path, body)
	if status != http.StatusCreated || got["secretSet"] != true || got["password"] != nil {
		t.Fatalf("create: %d %v", status, got)
	}
	id := got["id"].(string)
	var raw []byte
	if err := fx.Pool.QueryRow(context.Background(), "SELECT secret_ciphertext FROM backup_targets WHERE id = $1", id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("nas-secret-pw")) {
		t.Error("secret stored in clear")
	}
	var auditText string
	_ = fx.Pool.QueryRow(context.Background(), "SELECT coalesce(string_agg(after::text, ' '), '') FROM audit_log WHERE action LIKE 'backup_target.%'").Scan(&auditText)
	if strings.Contains(auditText, "nas-secret-pw") || !strings.Contains(auditText, "nas.local") {
		t.Errorf("audit: %s", auditText)
	}
	if status, _ := admin.Do("POST", path, body); status != http.StatusConflict {
		t.Errorf("same name twice: %d", status)
	}
	for _, b := range []map[string]any{
		{"name": "x", "kind": "sftp", "enabled": true, "keep": "7,4,12", "settings": map[string]any{"host": "h", "user": "u"}},                                               // no secret
		{"name": "y", "kind": "s3", "enabled": true, "keep": "7,4,12", "settings": map[string]any{"provider": "Other", "bucket": "b", "accessKeyId": "a"}, "secretKey": "s"}, // no endpoint
		{"name": "z", "kind": "local", "enabled": true, "keep": "every day", "settings": map[string]any{"path": "/mnt/nas"}},
	} {
		if status, _ := admin.Do("POST", path, b); status != http.StatusBadRequest {
			t.Errorf("invalid %v: %d", b["name"], status)
		}
	}
	// Another server without typing the password again: refused — the stored one never goes to a new address (P2-14).
	upd := map[string]any{"name": "NAS tầng 2", "kind": "sftp", "enabled": false, "keep": "14,8,24", "version": 1,
		"settings": map[string]any{"host": "attacker.example", "port": 22, "user": "backup", "path": "ntb", "hostKey": "attacker.example ssh-ed25519 AAAA"}}
	if status, body := admin.Do("PUT", path+"/"+id, upd); status != http.StatusBadRequest {
		t.Errorf("new host without the password: %d %v", status, body)
	}
	// Same server, other settings, password omitted: kept.
	upd["settings"] = map[string]any{"host": "nas.local", "port": 22, "user": "backup", "path": "ntb2", "hostKey": "nas.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5"}
	status, got = admin.Do("PUT", path+"/"+id, upd)
	if status != http.StatusOK || got["secretSet"] != true || got["enabled"] != false || got["version"] != float64(2) {
		t.Fatalf("update: %d %v", status, got)
	}
	if status, _ := admin.Do("PUT", path+"/"+id, upd); status != http.StatusConflict {
		t.Errorf("stale version: %d", status)
	}
	upd["kind"], upd["version"] = "s3", 2
	if status, _ := admin.Do("PUT", path+"/"+id, upd); status != http.StatusBadRequest {
		t.Errorf("kind change: %d", status)
	}
	_, list := admin.Do("GET", "/api/admin/backups", nil)
	if ts := list["targets"].([]any); len(ts) != 1 || ts[0].(map[string]any)["name"] != "NAS tầng 2" {
		t.Errorf("targets listed: %v", ts)
	}
	// Backups are off in this server: nothing to run.
	if status, _ := admin.Do("POST", "/api/admin/backups/run", nil); status != http.StatusConflict {
		t.Errorf("run with backups off: %d", status)
	}
	// Downloads need a confirmed MFA; bad names never reach the file system.
	// (The MFA gate is the vault's recentMFA, tested there; this admin has just confirmed MFA.)
	for _, name := range []string{"ntb-20261018T190000Z-manual.ntbbak", "..%2F..%2Fetc%2Fpasswd", "notes.txt"} {
		if status, _ := admin.Do("GET", "/api/admin/backups/files/"+name, nil); status != http.StatusNotFound {
			t.Errorf("download %s: %d", name, status)
		}
	}
	if status, _ := fx.A.Do("GET", "/api/admin/backups/files/x", nil); status != http.StatusForbidden {
		t.Errorf("org owner downloading: %d", status)
	}
	if status, _ := admin.Do("DELETE", path+"/"+id, nil); status != http.StatusNoContent {
		t.Errorf("delete: %d", status)
	}
	if status, _ := admin.Do("DELETE", path+"/"+id, nil); status != http.StatusNotFound {
		t.Errorf("delete twice: %d", status)
	}
}

// P2-14: sensitive system administration needs a fresh MFA confirmation (backup destinations, run now, mail server,
// other people's accounts); without one the answer is 428 and nothing changes.
func TestAdminStepUpMFA(t *testing.T) {
	fx := newOrgFixture(t)
	admin := fx.NewUser(t, "sysadmin-stepup@example.com", true)
	if _, err := fx.Pool.Exec(context.Background(), `UPDATE sessions SET mfa_verified_at = now() - interval '1 hour' WHERE user_id = $1`, admin.UserID); err != nil {
		t.Fatal(err)
	}
	target := map[string]any{"name": "S3", "kind": "s3", "enabled": true, "keep": "7,4,12", "secretKey": "s",
		"settings": map[string]any{"provider": "AWS", "bucket": "b", "accessKeyId": "AK"}}
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"POST", "/api/admin/backup-targets", target},
		{"POST", "/api/admin/backups/run", nil},
		{"PUT", "/api/admin/smtp", map[string]any{"host": "smtp.example.com", "port": 587, "security": "starttls", "username": "", "fromAddress": "a@b.vn", "fromName": "", "publicUrl": ""}},
		{"POST", "/api/admin/smtp/test", map[string]any{"to": "a@b.vn"}},
		{"POST", "/api/admin/users/" + fx.A.UserID.String() + "/reset-mfa", nil},
		{"POST", "/api/admin/users/" + fx.A.UserID.String() + "/password-reset", nil},
		{"POST", "/api/admin/users/" + fx.A.UserID.String() + "/disable", nil},
	} {
		if status, _ := admin.Do(c.method, c.path, c.body); status != 428 {
			t.Errorf("%s %s without a fresh MFA: %d, want 428", c.method, c.path, status)
		}
	}
	var n int
	_ = fx.Pool.QueryRow(context.Background(), "SELECT count(*) FROM backup_targets").Scan(&n)
	if n != 0 {
		t.Errorf("a destination was created without MFA")
	}
}

// P2-14: a system admin's action on someone's account shows in the log of every organization the person belongs to.
func TestAdminAccountActionsAuditedInOrgs(t *testing.T) {
	fx := newOrgFixture(t)
	admin := fx.NewUser(t, "sysadmin-audit@example.com", true)
	if status, _ := admin.Do("POST", "/api/admin/users/"+fx.A.UserID.String()+"/password-reset", nil); status != http.StatusOK {
		t.Fatalf("password reset: %d", status)
	}
	if auditCount(t, fx.Pool, "user.password_reset_issued", fx.OrgA) != 1 {
		t.Error("organization A's log does not show the reset link issued for its member")
	}
	if auditCount(t, fx.Pool, "user.password_reset_issued", fx.OrgB) != 0 {
		t.Error("organization B's log shows another organization's member")
	}
}
