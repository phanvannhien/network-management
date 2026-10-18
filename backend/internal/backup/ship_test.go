package backup

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/secrets"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/testdb"
)

func testKeys(t *testing.T) *secrets.Keyring {
	t.Helper()
	k, err := secrets.NewKeyring(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// P2-13 step 2: a good backup is copied to each enabled destination (here a mounted folder through rclone), the
// destination's own retention applies there, results are recorded, and a destination turning failed sends one e-mail.
func TestShipToDestinations(t *testing.T) {
	if _, err := exec.LookPath("rclone"); err != nil {
		t.Skip("rclone not installed")
	}
	pool, dbURL := testdb.New(t)
	requireMatchingClient(t, pool)
	ctx := context.Background()
	keys := testKeys(t)
	dir, nas := t.TempDir(), t.TempDir()
	q := store.New(pool)
	add := func(name, path string, enabled bool) uuid.UUID {
		id := uuid.New()
		settings, _ := json.Marshal(TargetSettings{Path: path})
		if _, err := q.CreateBackupTarget(ctx, store.CreateBackupTargetParams{ID: pgtype.UUID{Bytes: id, Valid: true}, Name: name,
			Kind: KindLocal, Enabled: enabled, Settings: settings, Keep: "7,4,12"}); err != nil {
			t.Fatal(err)
		}
		return id
	}
	add("NAS", filepath.Join(nas, "ntb"), true)
	add("Tắt", filepath.Join(nas, "off"), false)
	broken := add("Hỏng", "/nonexistent-root-dir/ntb", true)
	// An old scheduled backup on the NAS beyond the retention (and an unknown file, never touched).
	_ = os.MkdirAll(filepath.Join(nas, "ntb"), 0o700)
	old := FileName(time.Now().AddDate(-2, 0, 0), "manual")
	for i := range 6 {
		_ = os.WriteFile(filepath.Join(nas, "ntb", FileName(time.Now().AddDate(0, -i-1, 0), "manual")), []byte("x"), 0o600)
	}
	_ = os.WriteFile(filepath.Join(nas, "ntb", old), []byte("x"), 0o600)
	_ = os.WriteFile(filepath.Join(nas, "ntb", "notes.txt"), []byte("x"), 0o600)

	var mails []string
	svc := service(t, pool, dbURL, dir)
	svc.Cfg.Keys = keys
	svc.Cfg.Notify = func(_ context.Context, subject, _ string) error { mails = append(mails, subject); return nil }
	res, err := svc.Run(ctx, "manual")
	if err != nil {
		t.Fatalf("backup: %v", err)
	}
	if len(res.Shipped) != 2 {
		t.Fatalf("shipped to %d destinations, want 2 (the disabled one skipped)", len(res.Shipped))
	}
	if _, err := os.Stat(filepath.Join(nas, "ntb", res.File)); err != nil {
		t.Errorf("not on the NAS: %v", err)
	}
	if _, err := os.Stat(filepath.Join(nas, "off")); err == nil {
		t.Error("the disabled destination got a copy")
	}
	// Manual backups keep the newest 5 there too: the new one + 4 of the 7 old ones; notes.txt stays.
	entries, _ := os.ReadDir(filepath.Join(nas, "ntb"))
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	if len(names) != 6 || !strings.Contains(strings.Join(names, ","), "notes.txt") {
		t.Errorf("NAS after retention: %v", names)
	}
	rows, _ := q.ListBackupTargets(ctx)
	for _, r := range rows {
		switch r.Name {
		case "NAS":
			if r.LastStatus != "ok" || r.LastFile != res.File {
				t.Errorf("NAS result: %s %s %s", r.LastStatus, r.LastFile, r.LastError)
			}
		case "Hỏng":
			if r.LastStatus != "failed" || r.LastError == "" {
				t.Errorf("broken result: %s %q", r.LastStatus, r.LastError)
			}
		case "Tắt":
			if r.LastStatus != "" {
				t.Errorf("disabled destination recorded: %s", r.LastStatus)
			}
		}
	}
	if len(mails) != 1 || !strings.Contains(mails[0], "Hỏng") {
		t.Errorf("mails after the first failure: %v", mails)
	}
	// Still failing: no second e-mail.
	if _, err := svc.Run(ctx, "manual"); err != nil {
		t.Fatal(err)
	}
	if len(mails) != 1 {
		t.Errorf("mails after a repeated failure: %v", mails)
	}
	_ = broken
}

func TestTargetValidate(t *testing.T) {
	ok := []Target{
		{Kind: KindLocal, Settings: TargetSettings{Path: "/mnt/nas/ntb"}},
		{Kind: KindSFTP, Settings: TargetSettings{Host: "nas.local", User: "backup", Path: "ntb"}, Secret: TargetSecret{Password: "x"}},
		{Kind: KindS3, Settings: TargetSettings{Provider: "AWS", Bucket: "b", AccessKeyID: "AK"}, Secret: TargetSecret{SecretKey: "s"}},
		{Kind: KindS3, Settings: TargetSettings{Provider: "Other", Endpoint: "s3.us-west-004.backblazeb2.com", Bucket: "b", AccessKeyID: "AK"}, Secret: TargetSecret{SecretKey: "s"}},
		{Kind: KindDrive, Secret: TargetSecret{Token: `{"access_token":"a","refresh_token":"r","expiry":"2026-01-01T00:00:00Z"}`}},
	}
	for i, tg := range ok {
		if err := tg.Validate(); err != nil {
			t.Errorf("ok %d: %v", i, err)
		}
	}
	bad := []Target{
		{Kind: KindLocal, Settings: TargetSettings{Path: "relative"}},
		{Kind: KindLocal, Settings: TargetSettings{Path: "/mnt/../etc"}},
		{Kind: KindSFTP, Settings: TargetSettings{Host: "nas", User: "u"}},
		{Kind: KindSFTP, Settings: TargetSettings{Host: "nas", User: "u"}, Secret: TargetSecret{PrivateKey: "not a key"}},
		{Kind: KindS3, Settings: TargetSettings{Provider: "Other", Bucket: "b", AccessKeyID: "AK"}, Secret: TargetSecret{SecretKey: "s"}},
		{Kind: KindS3, Settings: TargetSettings{Provider: "AWS", Bucket: "b", AccessKeyID: "AK\nX"}, Secret: TargetSecret{SecretKey: "s"}},
		{Kind: KindDropbox, Secret: TargetSecret{Token: "paste here"}},
		{Kind: "ftp"},
	}
	for i, tg := range bad {
		if err := tg.Validate(); err == nil {
			t.Errorf("bad %d accepted", i)
		}
	}
}
