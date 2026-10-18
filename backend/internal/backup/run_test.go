package backup

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/database"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/testdb"
)

const testPass = "a-long-backup-passphrase"

// requireMatchingClient skips when the PostgreSQL client tools are another major than the server: a newer pg_dump
// writes settings an older server refuses (production pins the client to the server's major — api.Dockerfile).
func requireMatchingClient(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	bin := "pg_dump"
	if dir := os.Getenv("NTB_PG_BIN"); dir != "" {
		bin = filepath.Join(dir, "pg_dump")
	}
	out, err := exec.Command(bin, "--version").Output()
	if err != nil {
		t.Skipf("no pg_dump (%v); set NTB_PG_BIN", err)
	}
	var server int
	if err := pool.QueryRow(context.Background(), "SELECT current_setting('server_version_num')::int / 10000").Scan(&server); err != nil {
		t.Fatal(err)
	}
	if m := majorRe.FindStringSubmatch(string(out)); m == nil || m[1] != strconv.Itoa(server) {
		t.Skipf("pg_dump %q is not PostgreSQL %d: set NTB_PG_BIN=<repo>/deploy/pg16", strings.TrimSpace(string(out)), server)
	}
}

func service(t *testing.T, pool *pgxpool.Pool, dbURL, dir string) *Service {
	t.Helper()
	latest, err := database.LatestVersion()
	if err != nil {
		t.Fatal(err)
	}
	return &Service{Pool: pool, Logger: slog.New(slog.DiscardHandler), Cfg: Config{
		DatabaseURL: dbURL, Dir: dir, Passphrase: testPass, PgBin: os.Getenv("NTB_PG_BIN"), AppVersion: "test",
		KeyFingerprint: "fp-1", Policy: DefaultPolicy, LatestSchema: latest, Migrate: database.MigrateUp,
	}}
}

// P2-13: back up, read back, restore into a new database swapped in by name (the old one kept), with the safety
// checks (another master key, API running, newer schema).
func TestBackupRestore(t *testing.T) {
	pool, dbURL := testdb.New(t)
	ctx := context.Background()
	requireMatchingClient(t, pool)
	if _, err := pool.Exec(ctx, `INSERT INTO organizations (name, code) VALUES ('Công ty Sao Lưu', 'BAK')`); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	svc := service(t, pool, dbURL, dir)
	res, err := svc.Run(ctx, "manual")
	if err != nil {
		t.Fatalf("backup: %v", err)
	}
	if res.Size == 0 || !strings.HasSuffix(res.File, "-manual.ntbbak") {
		t.Fatalf("result: %+v", res)
	}
	info, _ := os.Stat(filepath.Join(dir, res.File))
	if info.Mode().Perm() != 0o600 {
		t.Errorf("file mode %v", info.Mode().Perm())
	}
	var status string
	var verified bool
	if err := pool.QueryRow(ctx, "SELECT status, verified_at IS NOT NULL FROM backup_runs WHERE file_name = $1", res.File).Scan(&status, &verified); err != nil || status != "ok" || !verified {
		t.Fatalf("run recorded: %v %s %v", err, status, verified)
	}

	full, err := svc.Verify(ctx, filepath.Join(dir, res.File), true)
	if err != nil {
		t.Fatalf("verify --full: %v", err)
	}
	if full.Counts["organizations"] != 1 {
		t.Errorf("test restore counts: %v", full.Counts)
	}

	// Data changes after the backup; the restore brings back the backup's state.
	if _, err := pool.Exec(ctx, `UPDATE organizations SET name = 'Đổi sau backup'`); err != nil {
		t.Fatal(err)
	}
	other := service(t, pool, dbURL, dir)
	other.Cfg.KeyFingerprint = "fp-2"
	if _, err := other.Restore(ctx, filepath.Join(dir, res.File), RestoreOptions{}); !errors.Is(err, ErrOtherKey) {
		t.Errorf("another master key: %v", err)
	}
	release, ok, err := HoldAPI(ctx, pool)
	if err != nil || !ok {
		t.Fatalf("api lock: %v %v", ok, err)
	}
	if _, err := svc.Restore(ctx, filepath.Join(dir, res.File), RestoreOptions{}); !errors.Is(err, ErrAPIRunning) {
		t.Errorf("API running: %v", err)
	}
	// Master key rotation is refused too while an API serves (P2-14).
	if _, err := LockOutAPI(ctx, pool); !errors.Is(err, ErrAPIRunning) {
		t.Errorf("rotation lock with the API running: %v", err)
	}
	release()
	newer := service(t, pool, dbURL, dir)
	newer.Cfg.LatestSchema = 1
	if _, err := newer.Restore(ctx, filepath.Join(dir, res.File), RestoreOptions{}); err == nil || !strings.Contains(err.Error(), "newer version") {
		t.Errorf("backup newer than the binary: %v", err)
	}

	restorePool, err := database.Open(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	rsvc := service(t, restorePool, dbURL, dir)
	rres, err := rsvc.Restore(ctx, filepath.Join(dir, res.File), RestoreOptions{})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	after, err := database.Open(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	defer after.Close()
	var name string
	if err := after.QueryRow(ctx, "SELECT name FROM organizations").Scan(&name); err != nil || name != "Công ty Sao Lưu" {
		t.Errorf("restored data: %v %q", err, name)
	}
	// The replaced database is kept, listed, and dropped on request.
	asvc := service(t, after, dbURL, dir)
	old, err := asvc.OldDatabases(ctx)
	if err != nil || len(old) != 1 || old[0] != rres.OldDatabase {
		t.Fatalf("old databases: %v %v (want %s)", old, err, rres.OldDatabase)
	}
	if err := asvc.DropOld(ctx, "postgres"); err == nil {
		t.Error("dropped a database that is not a restore's")
	}
	if err := asvc.DropOld(ctx, rres.OldDatabase); err != nil {
		t.Errorf("drop old: %v", err)
	}

	// A wrong passphrase or a damaged file never reaches the database.
	bad := service(t, after, dbURL, dir)
	bad.Cfg.Passphrase = "another-long-passphrase"
	if _, err := bad.Verify(ctx, filepath.Join(dir, res.File), false); !errors.Is(err, ErrPassphrase) {
		t.Errorf("wrong passphrase: %v", err)
	}
}
