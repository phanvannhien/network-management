package backup

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

// Config is where and how backups are made (environment, ADR-053).
type Config struct {
	DatabaseURL string
	// Dir holds the backup files (a Docker volume; may be a mounted NAS share).
	Dir        string
	Passphrase string
	// PgBin is the directory of pg_dump / pg_restore ("" = PATH). The client must be at least the server's major.
	PgBin      string
	AppVersion string
	// KeyFingerprint / KeyVersion name the current master key (never the key itself).
	KeyFingerprint string
	KeyVersion     int16
	Policy         Policy
	// LatestSchema is the newest migration of this binary: a newer backup is refused (no downgrade).
	LatestSchema uint
	// Migrate brings a restored (older) database up to this binary's schema.
	Migrate func(databaseURL string) error
	// CheckKeys tells whether the restored database's secrets open with the current master key version.
	CheckKeys func(ctx context.Context, pool *pgxpool.Pool) error
}

// Service makes, checks and restores backups of the installation's database.
type Service struct {
	Pool   *pgxpool.Pool
	Cfg    Config
	Logger *slog.Logger
}

var (
	// ErrBusy means another backup or restore is running.
	ErrBusy = errors.New("backup: another backup or restore is running")
	// ErrAPIRunning means the API is serving: a restore needs it stopped.
	ErrAPIRunning = errors.New("backup: the API is running — stop it first (docker compose stop api)")
	// ErrOtherKey means the backup's secrets were sealed with another master key.
	ErrOtherKey = errors.New("backup: made with another master key — with the current key the vault's passwords and MFA seeds will not open")
)

// Advisory lock keys: one backup / restore at a time; the API holds "api" shared while it serves, a restore takes it
// exclusive.
const (
	lockBackup = "ntb:backup"
	lockAPI    = "ntb:api"
)

// Result describes a finished backup.
type Result struct {
	File     string
	Size     int64
	SHA256   string
	Pruned   int
	Duration time.Duration
}

func (s *Service) bin(name string) string {
	if s.Cfg.PgBin != "" {
		return filepath.Join(s.Cfg.PgBin, name)
	}
	return name
}

// dsnFor is the database URL pointed at another database of the same server, without its password.
func dsnFor(databaseURL, database string) (dsn string, password string, err error) {
	u, err := url.Parse(databaseURL)
	if err != nil {
		return "", "", fmt.Errorf("backup: database url: %w", err)
	}
	if u.User != nil {
		password, _ = u.User.Password()
		u.User = url.User(u.User.Username())
	}
	if database != "" {
		u.Path = "/" + database
	}
	return u.String(), password, nil
}

// connect opens a single connection to a database of the server.
func (s *Service) connect(ctx context.Context, database string) (*pgx.Conn, error) {
	dsn, pw, err := dsnFor(s.Cfg.DatabaseURL, database)
	if err != nil {
		return nil, err
	}
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("backup: %w", err)
	}
	cfg.Password = pw
	c, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("backup: connect %s: %w", database, err)
	}
	return c, nil
}

// limited keeps the first 8 KiB of a tool's error output for the message.
type limited struct{ bytes.Buffer }

func (l *limited) Write(p []byte) (int, error) {
	if room := 8<<10 - l.Len(); room > 0 {
		l.Buffer.Write(p[:min(room, len(p))])
	}
	return len(p), nil
}

// command prepares pg_dump / pg_restore. With a database the connection goes in --dbname and the password in
// PGPASSWORD (never on a command line other processes can read).
func (s *Service) command(ctx context.Context, name, database string, useDB bool, args ...string) (*exec.Cmd, *limited, error) {
	cmd := exec.CommandContext(ctx, s.bin(name), args...)
	cmd.Env = os.Environ()
	if useDB {
		dsn, pw, err := dsnFor(s.Cfg.DatabaseURL, database)
		if err != nil {
			return nil, nil, err
		}
		cmd.Args = append(cmd.Args, "--dbname="+dsn)
		if pw != "" {
			cmd.Env = append(cmd.Env, "PGPASSWORD="+pw)
		}
	}
	stderr := &limited{}
	cmd.Stderr = stderr
	return cmd, stderr, nil
}

func toolError(name string, err error, stderr *limited) error {
	msg := strings.TrimSpace(stderr.String())
	if msg == "" {
		return fmt.Errorf("%s: %w", name, err)
	}
	return fmt.Errorf("%s: %w: %s", name, err, msg)
}

var majorRe = regexp.MustCompile(`(\d+)(?:\.\d+)?`)

// checkClient refuses a pg_dump older than the server and warns about a newer one (its dumps may carry settings an
// older server rejects on restore).
func (s *Service) checkClient(ctx context.Context, conn *pgxpool.Conn) (string, error) {
	var server string
	var serverNum int
	if err := conn.QueryRow(ctx, "SELECT current_setting('server_version'), current_setting('server_version_num')::int").Scan(&server, &serverNum); err != nil {
		return "", fmt.Errorf("backup: server version: %w", err)
	}
	out, err := exec.CommandContext(ctx, s.bin("pg_dump"), "--version").Output()
	if err != nil {
		return server, fmt.Errorf("backup: pg_dump not found (install the PostgreSQL client or set NTB_PG_BIN): %w", err)
	}
	m := majorRe.FindStringSubmatch(string(out))
	if m == nil {
		return server, fmt.Errorf("backup: cannot read pg_dump version from %q", strings.TrimSpace(string(out)))
	}
	client, _ := strconv.Atoi(m[1])
	switch {
	case client < serverNum/10000:
		return server, fmt.Errorf("backup: pg_dump %d is older than the server (%s): install a PostgreSQL %d client", client, server, serverNum/10000)
	case client > serverNum/10000 && s.Logger != nil:
		s.Logger.Warn("backup: pg_dump is newer than the server; restore with the same client version", "client", client, "server", server)
	}
	return server, nil
}

func tryLock(ctx context.Context, conn *pgxpool.Conn, key string, shared bool) (bool, error) {
	fn := "pg_try_advisory_lock"
	if shared {
		fn = "pg_try_advisory_lock_shared"
	}
	var ok bool
	if err := conn.QueryRow(ctx, "SELECT "+fn+"(hashtextextended($1, 0))", key).Scan(&ok); err != nil {
		return false, fmt.Errorf("backup lock: %w", err)
	}
	return ok, nil
}

func unlock(conn *pgxpool.Conn, key string, shared bool) {
	fn := "pg_advisory_unlock"
	if shared {
		fn = "pg_advisory_unlock_shared"
	}
	// A fresh context: the caller's may be cancelled; the lock must still go.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = conn.Exec(ctx, "SELECT "+fn+"(hashtextextended($1, 0))", key)
}

type rowQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// SchemaVersion is the migration the database is at (0 = empty) and whether one failed halfway.
func SchemaVersion(ctx context.Context, q rowQuerier) (uint, bool, error) {
	var v int64
	var dirty bool
	err := q.QueryRow(ctx, "SELECT version, dirty FROM schema_migrations LIMIT 1").Scan(&v, &dirty)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || strings.Contains(err.Error(), "does not exist") {
			return 0, false, nil
		}
		return 0, false, fmt.Errorf("schema version: %w", err)
	}
	return uint(v), dirty, nil
}

// HoldAPI is taken by the API while it serves (shared, so several API processes may run): a restore cannot start
// meanwhile. ok false: a restore is running. Call release when the API stops.
func HoldAPI(ctx context.Context, pool *pgxpool.Pool) (release func(), ok bool, err error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("api lock: %w", err)
	}
	ok, err = tryLock(ctx, conn, lockAPI, true)
	if err != nil || !ok {
		conn.Release()
		return nil, ok, err
	}
	return func() { unlock(conn, lockAPI, true); conn.Release() }, true, nil
}

// Run makes one backup of the given kind into Cfg.Dir, reads it back completely, records it in backup_runs and
// applies the retention (only after a backup that reads back).
func (s *Service) Run(ctx context.Context, kind string) (Result, error) {
	var res Result
	if s.Cfg.Passphrase == "" {
		return res, errors.New("backup: NTB_BACKUP_PASSPHRASE is not set")
	}
	conn, err := s.Pool.Acquire(ctx)
	if err != nil {
		return res, fmt.Errorf("backup: connect: %w", err)
	}
	defer conn.Release()
	ok, err := tryLock(ctx, conn, lockBackup, false)
	if err != nil {
		return res, err
	}
	if !ok {
		return res, ErrBusy
	}
	defer unlock(conn, lockBackup, false)

	q := store.New(conn)
	_ = q.FailStaleBackupRuns(ctx)
	schema, _, err := SchemaVersion(ctx, conn)
	if err != nil {
		return res, err
	}
	id, err := q.StartBackupRun(ctx, store.StartBackupRunParams{Kind: kind, AppVersion: s.Cfg.AppVersion,
		SchemaVersion: int32(schema), KeyFingerprint: s.Cfg.KeyFingerprint})
	// A database from before backups existed (the pre-upgrade backup of that upgrade) has no history table: the
	// backup is made all the same, just not recorded.
	recorded := err == nil
	if err != nil && !strings.Contains(err.Error(), "backup_runs") {
		return res, fmt.Errorf("backup: record start: %w", err)
	}
	started := time.Now()
	res, runErr := s.dump(ctx, conn, kind, schema)
	if runErr == nil {
		// Read every chunk and every table back; a backup that does not is deleted, never kept as if good.
		if _, err := s.Verify(ctx, filepath.Join(s.Cfg.Dir, res.File), false); err != nil {
			_ = os.Remove(filepath.Join(s.Cfg.Dir, res.File))
			runErr = fmt.Errorf("backup: the new file does not read back: %w", err)
			res = Result{}
		}
	}
	if runErr == nil {
		res.Pruned = s.prune()
	}
	res.Duration = time.Since(started)
	finish := store.FinishBackupRunParams{ID: id, Status: "ok", FileName: res.File, SizeBytes: res.Size, Sha256: res.SHA256, Pruned: int32(res.Pruned)}
	if runErr != nil {
		finish.Status, finish.Error = "failed", runErr.Error()
	}
	// Recorded even when the caller's context ended (a failed backup must show as failed).
	if !recorded {
		return res, runErr
	}
	recCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := q.FinishBackupRun(recCtx, finish); err != nil && runErr == nil {
		runErr = fmt.Errorf("backup: record result: %w", err)
	}
	if runErr == nil {
		_ = q.MarkBackupVerified(recCtx, store.MarkBackupVerifiedParams{FileName: res.File})
	}
	return res, runErr
}

func (s *Service) dump(ctx context.Context, conn *pgxpool.Conn, kind string, schema uint) (Result, error) {
	var res Result
	server, err := s.checkClient(ctx, conn)
	if err != nil {
		return res, err
	}
	var database string
	if err := conn.QueryRow(ctx, "SELECT current_database()").Scan(&database); err != nil {
		return res, fmt.Errorf("backup: database name: %w", err)
	}
	if err := os.MkdirAll(s.Cfg.Dir, 0o700); err != nil {
		return res, fmt.Errorf("backup: directory: %w", err)
	}
	// Room for at least twice the last good backup (or 64 MiB for the first).
	need := int64(64 << 20)
	if last, ok, _ := LastGood(ctx, store.New(conn)); ok {
		need = max(need, 2*last.SizeBytes)
	}
	if free := freeBytes(s.Cfg.Dir); free >= 0 && free < need {
		return res, fmt.Errorf("backup: only %d MiB free in %s, need about %d MiB", free>>20, s.Cfg.Dir, need>>20)
	}
	now := time.Now()
	name := FileName(now, kind)
	final := filepath.Join(s.Cfg.Dir, name)
	tmp := filepath.Join(s.Cfg.Dir, "."+name+".partial")
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return res, fmt.Errorf("backup: create file: %w", err)
	}
	done := false
	defer func() {
		if !done {
			_ = f.Close()
			_ = os.Remove(tmp)
		}
	}()
	sum := sha256.New()
	counter := &countingWriter{w: io.MultiWriter(f, sum)}
	enc, err := NewEncrypter(counter, s.Cfg.Passphrase, Meta{
		CreatedAt: now.UTC().Format(time.RFC3339), Kind: kind, AppVersion: s.Cfg.AppVersion, SchemaVersion: schema,
		Database: database, ServerVersion: server, KeyFingerprint: s.Cfg.KeyFingerprint, KeyVersion: s.Cfg.KeyVersion,
	})
	if err != nil {
		return res, err
	}
	// Custom format (restorable table by table); owners and grants left out so it restores into any database / role;
	// sessions left out (a restore signs everyone out anyway).
	cmd, stderr, err := s.command(ctx, "pg_dump", "", true,
		"--format=custom", "--compress=6", "--no-owner", "--no-privileges", "--exclude-table-data=sessions")
	if err != nil {
		return res, err
	}
	cmd.Stdout = enc
	if err := cmd.Run(); err != nil {
		// The last chunk is sealed only after pg_dump succeeded: a dump cut short never looks complete.
		return res, toolError("pg_dump", err, stderr)
	}
	if err := enc.Close(); err != nil {
		return res, err
	}
	if err := f.Sync(); err != nil {
		return res, fmt.Errorf("backup: sync: %w", err)
	}
	if err := f.Close(); err != nil {
		return res, fmt.Errorf("backup: close: %w", err)
	}
	if err := os.Rename(tmp, final); err != nil {
		return res, fmt.Errorf("backup: rename: %w", err)
	}
	done = true
	syncDir(s.Cfg.Dir)
	res.File, res.Size, res.SHA256 = name, counter.n, hex.EncodeToString(sum.Sum(nil))
	return res, nil
}

type countingWriter struct {
	w io.Writer
	n int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.n += int64(n)
	return n, err
}

func syncDir(dir string) {
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
}

// Files lists the backups in the directory, newest first.
func (s *Service) Files() ([]File, error) {
	entries, err := os.ReadDir(s.Cfg.Dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("backup: list: %w", err)
	}
	var out []File
	for _, e := range entries {
		if f, ok := ParseFileName(e.Name()); ok && e.Type().IsRegular() {
			out = append(out, f)
		}
	}
	slices.SortFunc(out, func(a, b File) int { return b.At.Compare(a.At) })
	return out, nil
}

func (s *Service) prune() int {
	files, err := s.Files()
	if err != nil {
		s.Logger.Warn("backup retention: list", "error", err)
		return 0
	}
	_, drop := Prune(files, s.Cfg.Policy)
	n := 0
	for _, f := range drop {
		if err := os.Remove(filepath.Join(s.Cfg.Dir, f.Name)); err != nil {
			s.Logger.Warn("backup retention: delete", "file", f.Name, "error", err)
			continue
		}
		n++
	}
	return n
}

// CleanPartials deletes files left by a backup that died (power cut, kill) — at startup, before any backup runs.
func (s *Service) CleanPartials() {
	entries, _ := os.ReadDir(s.Cfg.Dir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".ntb-") && strings.HasSuffix(e.Name(), ".partial") {
			_ = os.Remove(filepath.Join(s.Cfg.Dir, e.Name()))
		}
	}
}

// Resolve accepts a file name in the backup directory or a path.
func (s *Service) Resolve(file string) string {
	if !strings.ContainsRune(file, filepath.Separator) {
		if _, err := os.Stat(filepath.Join(s.Cfg.Dir, file)); err == nil {
			return filepath.Join(s.Cfg.Dir, file)
		}
	}
	return file
}

// restoreStream decrypts a backup straight into pg_restore (no clear copy on disk). Every chunk is read and
// authenticated even when pg_restore stops early; a decryption error wins over pg_restore's (it is the cause).
func (s *Service) restoreStream(ctx context.Context, path, database string, useDB bool, args ...string) (Meta, error) {
	in, err := os.Open(path)
	if err != nil {
		return Meta{}, fmt.Errorf("backup: open: %w", err)
	}
	defer func() { _ = in.Close() }()
	cmd, stderr, err := s.command(ctx, "pg_restore", database, useDB, args...)
	if err != nil {
		return Meta{}, err
	}
	pr, pw := io.Pipe()
	cmd.Stdin = pr
	type out struct {
		meta Meta
		err  error
	}
	done := make(chan out, 1)
	go func() {
		meta, err := Decrypt(pw, in, s.Cfg.Passphrase)
		_ = pw.CloseWithError(err)
		done <- out{meta, err}
	}()
	runErr := cmd.Run()
	_, _ = io.Copy(io.Discard, pr) // let the decryption reach the end (truncation shows there)
	d := <-done
	if d.err != nil {
		return d.meta, d.err
	}
	if runErr != nil {
		return d.meta, toolError("pg_restore", runErr, stderr)
	}
	return d.meta, nil
}

// VerifyResult is what a verification found.
type VerifyResult struct {
	Meta Meta
	// Counts of a test restore (nil without one).
	Counts map[string]int64
}

// Verify reads a backup completely: every chunk is decrypted and authenticated and pg_restore reads every table
// (into /dev/null). With full it restores into a throw-away database, counts what is inside and drops it.
func (s *Service) Verify(ctx context.Context, path string, full bool) (VerifyResult, error) {
	var res VerifyResult
	var err error
	if !full {
		res.Meta, err = s.restoreStream(ctx, path, "", false, "--file="+os.DevNull)
	} else {
		err = s.verifyFull(ctx, path, &res)
	}
	if s.Pool != nil {
		msg := ""
		if err != nil {
			msg = err.Error()
		}
		recCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = store.New(s.Pool).MarkBackupVerified(recCtx, store.MarkBackupVerifiedParams{FileName: filepath.Base(path), VerifyError: msg})
	}
	return res, err
}

func randomName(prefix string) string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

func (s *Service) verifyFull(ctx context.Context, path string, res *VerifyResult) error {
	db := randomName("ntb_verify_")
	if _, err := s.Pool.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{db}.Sanitize()); err != nil {
		return fmt.Errorf("backup verify: create test database (needs CREATEDB): %w", err)
	}
	defer s.dropDatabase(db)
	meta, err := s.restoreStream(ctx, path, db, true, "--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction")
	res.Meta = meta
	if err != nil {
		return err
	}
	c, err := s.connect(ctx, db)
	if err != nil {
		return err
	}
	defer func() { _ = c.Close(context.Background()) }()
	res.Counts, err = counts(ctx, c)
	return err
}

func counts(ctx context.Context, c *pgx.Conn) (map[string]int64, error) {
	out := map[string]int64{}
	for _, t := range []struct{ name, sql string }{
		{"organizations", "SELECT count(*) FROM organizations"},
		{"users", "SELECT count(*) FROM users"},
		{"devices", "SELECT count(*) FROM devices WHERE deleted_at IS NULL"},
		{"diagrams", "SELECT count(*) FROM diagrams"},
		{"subnets", "SELECT count(*) FROM subnets"},
	} {
		var n int64
		if err := c.QueryRow(ctx, t.sql).Scan(&n); err != nil {
			return nil, fmt.Errorf("backup verify: count %s: %w", t.name, err)
		}
		out[t.name] = n
	}
	return out, nil
}

func (s *Service) dropDatabase(db string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, _ = s.Pool.Exec(ctx, "DROP DATABASE IF EXISTS "+pgx.Identifier{db}.Sanitize()+" WITH (FORCE)")
}

// RestoreOptions loosen the restore's safety checks.
type RestoreOptions struct {
	// AllowOtherKey restores a backup made with another master key (its vault passwords stay unreadable).
	AllowOtherKey bool
}

// RestoreResult reports a restore.
type RestoreResult struct {
	Meta Meta
	// OldDatabase is the replaced database, kept under this name until dropped (ntb backup drop-old).
	OldDatabase  string
	SchemaBefore uint
	SchemaAfter  uint
	Counts       map[string]int64
}

// Restore replaces the database with a backup without ever touching it in place:
//
//  1. checks: same master key, not newer than this binary, the API stopped;
//  2. restores into a new database <name>_restore_<id> in one transaction and migrates it to this binary's schema;
//  3. checks it (counts, master key version);
//  4. renames the current database to <name>_pre_restore_<id> (kept) and the new one to <name>.
//
// Any failure before step 4 leaves the current database as it was. It closes s.Pool (the database is renamed).
func (s *Service) Restore(ctx context.Context, path string, opts RestoreOptions) (RestoreResult, error) {
	var res RestoreResult
	in, err := os.Open(path)
	if err != nil {
		return res, fmt.Errorf("backup: open: %w", err)
	}
	meta, err := ReadMeta(in)
	_ = in.Close()
	if err != nil {
		return res, err
	}
	res.Meta = meta
	if meta.KeyFingerprint != s.Cfg.KeyFingerprint && !opts.AllowOtherKey {
		return res, ErrOtherKey
	}
	if s.Cfg.LatestSchema > 0 && meta.SchemaVersion > s.Cfg.LatestSchema {
		return res, fmt.Errorf("backup: made by a newer version (schema %d, this one knows %d) — restore it with that version or newer", meta.SchemaVersion, s.Cfg.LatestSchema)
	}
	conn, err := s.Pool.Acquire(ctx)
	if err != nil {
		return res, fmt.Errorf("backup: connect: %w", err)
	}
	locked := true
	release := func() {
		if locked {
			unlock(conn, lockBackup, false)
			unlock(conn, lockAPI, false)
			conn.Release()
			locked = false
		}
	}
	defer release()
	if ok, err := tryLock(ctx, conn, lockAPI, false); err != nil || !ok {
		conn.Release()
		locked = false
		if err != nil {
			return res, err
		}
		return res, ErrAPIRunning
	}
	if ok, err := tryLock(ctx, conn, lockBackup, false); err != nil || !ok {
		unlock(conn, lockAPI, false)
		conn.Release()
		locked = false
		if err != nil {
			return res, err
		}
		return res, ErrBusy
	}
	var current string
	if err := conn.QueryRow(ctx, "SELECT current_database()").Scan(&current); err != nil {
		return res, fmt.Errorf("backup: database name: %w", err)
	}
	if res.SchemaBefore, _, err = SchemaVersion(ctx, conn); err != nil {
		return res, err
	}
	stamp := time.Now().UTC().Format("20060102t150405")
	fresh := current + "_restore_" + stamp
	res.OldDatabase = current + "_pre_restore_" + stamp
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{fresh}.Sanitize()); err != nil {
		return res, fmt.Errorf("backup: create the new database (needs CREATEDB): %w", err)
	}
	swapped := false
	defer func() {
		if !swapped {
			s.dropDatabase(fresh)
		}
	}()
	if _, err := s.restoreStream(ctx, path, fresh, true, "--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction"); err != nil {
		return res, err
	}
	freshURL, _, _ := dsnFor(s.Cfg.DatabaseURL, fresh)
	if u, perr := url.Parse(s.Cfg.DatabaseURL); perr == nil && u.User != nil {
		if fu, ferr := url.Parse(freshURL); ferr == nil {
			fu.User = u.User
			freshURL = fu.String()
		}
	}
	if s.Cfg.Migrate != nil {
		if err := s.Cfg.Migrate(freshURL); err != nil {
			return res, fmt.Errorf("backup: migrate the restored database: %w", err)
		}
	}
	if err := s.checkRestored(ctx, fresh, freshURL, opts, &res); err != nil {
		return res, err
	}
	// Swap: nobody may stay connected to either database (our own pool included).
	release()
	s.Pool.Close()
	admin, err := s.connect(ctx, "postgres")
	if err != nil {
		return res, err
	}
	defer func() { _ = admin.Close(context.Background()) }()
	if _, err := admin.Exec(ctx, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ANY($1) AND pid <> pg_backend_pid()",
		[]string{current, fresh}); err != nil {
		return res, fmt.Errorf("backup: disconnect sessions: %w", err)
	}
	if _, err := admin.Exec(ctx, "ALTER DATABASE "+pgx.Identifier{current}.Sanitize()+" RENAME TO "+pgx.Identifier{res.OldDatabase}.Sanitize()); err != nil {
		return res, fmt.Errorf("backup: rename the current database: %w", err)
	}
	if _, err := admin.Exec(ctx, "ALTER DATABASE "+pgx.Identifier{fresh}.Sanitize()+" RENAME TO "+pgx.Identifier{current}.Sanitize()); err != nil {
		_, _ = admin.Exec(context.Background(), "ALTER DATABASE "+pgx.Identifier{res.OldDatabase}.Sanitize()+" RENAME TO "+pgx.Identifier{current}.Sanitize())
		return res, fmt.Errorf("backup: rename the restored database (the current one is back): %w", err)
	}
	swapped = true
	return res, nil
}

// checkRestored makes sure the restored database is usable before it replaces the current one.
func (s *Service) checkRestored(ctx context.Context, db, dbURL string, opts RestoreOptions, res *RestoreResult) error {
	c, err := s.connect(ctx, db)
	if err != nil {
		return err
	}
	defer func() { _ = c.Close(context.Background()) }()
	version, dirty, err := SchemaVersion(ctx, c)
	if err != nil {
		return err
	}
	if dirty {
		return fmt.Errorf("backup: the restored database has a half-applied migration (%d)", version)
	}
	res.SchemaAfter = version
	if res.Counts, err = counts(ctx, c); err != nil {
		return err
	}
	if s.Cfg.CheckKeys != nil && !opts.AllowOtherKey {
		pool, err := pgxpool.New(ctx, dbURL)
		if err != nil {
			return fmt.Errorf("backup: %w", err)
		}
		defer pool.Close()
		if err := s.Cfg.CheckKeys(ctx, pool); err != nil {
			return fmt.Errorf("backup: %w (start with the key / version the backup was made with, then run ntb rotate-master-key)", err)
		}
	}
	return nil
}

// OldDatabases lists databases kept by earlier restores.
func (s *Service) OldDatabases(ctx context.Context) ([]string, error) {
	var current string
	if err := s.Pool.QueryRow(ctx, "SELECT current_database()").Scan(&current); err != nil {
		return nil, fmt.Errorf("backup: database name: %w", err)
	}
	rows, err := s.Pool.Query(ctx, "SELECT datname FROM pg_database WHERE starts_with(datname, $1) ORDER BY datname", current+"_pre_restore_")
	if err != nil {
		return nil, fmt.Errorf("backup: list databases: %w", err)
	}
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("backup: list databases: %w", err)
	}
	return names, nil
}

// DropOld drops a database kept by an earlier restore.
func (s *Service) DropOld(ctx context.Context, name string) error {
	old, err := s.OldDatabases(ctx)
	if err != nil {
		return err
	}
	if !slices.Contains(old, name) {
		return fmt.Errorf("backup: %q is not a database kept by a restore", name)
	}
	if _, err := s.Pool.Exec(ctx, "DROP DATABASE "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)"); err != nil {
		return fmt.Errorf("backup: drop %s: %w", name, err)
	}
	return nil
}

// LastGood is the newest successful backup (ok false: none).
func LastGood(ctx context.Context, q store.Querier) (store.BackupRun, bool, error) {
	r, err := q.LastGoodBackup(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, false, nil
	}
	if err != nil {
		return r, false, fmt.Errorf("last backup: %w", err)
	}
	return r, true, nil
}

// Stale tells whether the newest good backup is older than the limit (or missing).
func Stale(last pgtype.Timestamptz, ok bool, limit time.Duration, now time.Time) bool {
	return !ok || !last.Valid || now.Sub(last.Time) > limit
}
