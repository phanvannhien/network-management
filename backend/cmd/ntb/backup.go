package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/term"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/backup"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/config"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/database"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/notify"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/rotate"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/secrets"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

const backupUsage = `usage:
  ntb backup run                         back up the database now (into NTB_BACKUP_DIR)
  ntb backup list                        backups in NTB_BACKUP_DIR and the recent runs
  ntb backup verify FILE [--full]        read a backup completely; --full restores it into a throw-away database
  ntb backup restore FILE --yes          replace the database with a backup (stop the API first)
        [--accept-key-mismatch] [--passphrase-file F]
  ntb backup decrypt FILE --out F        write the plain pg_dump file (pg_restore reads it) [--passphrase-file F]
  ntb backup drop-old [NAME --yes]       list / drop databases kept by earlier restores`

// newBackupService wires a backup service from the environment.
func newBackupService(cfg config.Config, pool *pgxpool.Pool, logger *slog.Logger) (*backup.Service, error) {
	master, err := secrets.ParseMasterKey(cfg.MasterKey)
	if err != nil {
		return nil, err
	}
	version, err := cfg.KeyVersion()
	if err != nil {
		return nil, err
	}
	keys, err := secrets.NewKeyringVersion(master, version)
	if err != nil {
		return nil, err
	}
	policy, err := backup.ParsePolicy(cfg.BackupKeep)
	if err != nil {
		return nil, err
	}
	latest, err := database.LatestVersion()
	if err != nil {
		return nil, err
	}
	return &backup.Service{Pool: pool, Logger: logger, Cfg: backup.Config{
		DatabaseURL: cfg.DatabaseURL, Dir: cfg.BackupDir, Passphrase: cfg.BackupPassphrase, PgBin: cfg.PgBin,
		AppVersion: cfg.Version, KeyFingerprint: secrets.Fingerprint(master), KeyVersion: version, Policy: policy,
		LatestSchema: latest, Migrate: database.MigrateUp,
		CheckKeys: func(ctx context.Context, p *pgxpool.Pool) error { return rotate.CheckVersions(ctx, store.New(p), keys) },
		Keys:      keys, Rclone: backup.Rclone{Bin: os.Getenv("NTB_RCLONE")},
		Notify: func(ctx context.Context, subject, text string) error {
			return mailSystemAdmins(ctx, pool, keys, subject, text)
		},
	}}, nil
}

// mailSystemAdmins sends a backup alert to every active system admin through the installation's mail server.
func mailSystemAdmins(ctx context.Context, pool *pgxpool.Pool, keys *secrets.Keyring, subject, text string) error {
	q := store.New(pool)
	cfg, _, err := notify.LoadSMTP(ctx, q, keys)
	if err != nil {
		return err
	}
	if !cfg.Configured() {
		return notify.ErrNotConfigured
	}
	to, err := q.BackupAlertRecipients(ctx)
	if err != nil {
		return fmt.Errorf("backup alert recipients: %w", err)
	}
	if len(to) == 0 {
		return nil
	}
	return notify.SendSMTP(ctx, cfg, notify.Message{To: to, Subject: "[NTB] " + subject, Text: text})
}

// readPassphrase: --passphrase-file, else the environment, else typed (an old backup may use an old passphrase).
func readPassphrase(file, env string, stderr io.Writer) (string, error) {
	if file != "" {
		b, err := os.ReadFile(file)
		if err != nil {
			return "", fmt.Errorf("passphrase file: %w", err)
		}
		return strings.TrimRight(string(b), "\r\n"), nil
	}
	if env != "" {
		return env, nil
	}
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return "", errors.New("no passphrase: set NTB_BACKUP_PASSPHRASE or use --passphrase-file")
	}
	_, _ = fmt.Fprint(stderr, "Backup passphrase: ")
	b, err := term.ReadPassword(int(os.Stdin.Fd()))
	_, _ = fmt.Fprintln(stderr)
	if err != nil {
		return "", fmt.Errorf("read passphrase: %w", err)
	}
	return string(b), nil
}

func backupCommand(logger *slog.Logger, args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		_, _ = fmt.Fprintln(stderr, backupUsage)
		return errors.New("backup: missing command")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg := config.Load()
	if loc, err := time.LoadLocation(cfg.Timezone); err == nil && os.Getenv("TZ") == "" {
		time.Local = loc
	}
	fs := flag.NewFlagSet("backup "+args[0], flag.ContinueOnError)
	fs.SetOutput(stderr)
	full := fs.Bool("full", false, "restore into a throw-away database")
	yes := fs.Bool("yes", false, "confirm")
	otherKey := fs.Bool("accept-key-mismatch", false, "restore a backup made with another master key")
	passFile := fs.String("passphrase-file", "", "file holding the backup passphrase")
	out := fs.String("out", "", "output file")
	// Flags may come after the file name.
	var positional []string
	rest := args[1:]
	for len(rest) > 0 {
		if err := fs.Parse(rest); err != nil {
			return err
		}
		rest = fs.Args()
		if len(rest) > 0 {
			positional = append(positional, rest[0])
			rest = rest[1:]
		}
	}
	file := ""
	if len(positional) > 0 {
		file = positional[0]
	}

	if args[0] == "decrypt" {
		// Works without the database (another machine, an old file).
		if file == "" || *out == "" {
			return errors.New("usage: ntb backup decrypt FILE --out F")
		}
		pass, err := readPassphrase(*passFile, cfg.BackupPassphrase, stderr)
		if err != nil {
			return err
		}
		return decryptFile(file, *out, pass, stdout)
	}

	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	svc, err := newBackupService(cfg, pool, logger)
	if err != nil {
		return err
	}
	switch args[0] {
	case "run":
		res, err := svc.Run(ctx, "manual")
		if err != nil {
			return err
		}
		_, _ = fmt.Fprintf(stdout, "backup %s (%d bytes, read back OK, %d old ones removed) in %s\n", filepath.Join(cfg.BackupDir, res.File), res.Size, res.Pruned, res.Duration.Round(time.Millisecond))
		return nil
	case "list":
		return listBackups(ctx, svc, stdout)
	case "verify":
		if file == "" {
			return errors.New("usage: ntb backup verify FILE [--full]")
		}
		if svc.Cfg.Passphrase, err = readPassphrase(*passFile, cfg.BackupPassphrase, stderr); err != nil {
			return err
		}
		res, err := svc.Verify(ctx, svc.Resolve(file), *full)
		if err != nil {
			return err
		}
		_, _ = fmt.Fprintf(stdout, "OK: %s backup of %s, schema %d, made %s\n", res.Meta.Kind, res.Meta.Database, res.Meta.SchemaVersion, res.Meta.CreatedAt)
		if res.Counts != nil {
			_, _ = fmt.Fprintf(stdout, "restored for the test: %v\n", res.Counts)
		}
		return nil
	case "restore":
		if file == "" {
			return errors.New("usage: ntb backup restore FILE --yes")
		}
		if !*yes {
			return errors.New("restore replaces the whole database: add --yes (the current one is kept under another name)")
		}
		if svc.Cfg.Passphrase, err = readPassphrase(*passFile, cfg.BackupPassphrase, stderr); err != nil {
			return err
		}
		res, err := svc.Restore(ctx, svc.Resolve(file), backup.RestoreOptions{AllowOtherKey: *otherKey})
		if err != nil {
			return err
		}
		_, _ = fmt.Fprintf(stdout, "restored the %s backup made %s (schema %d → %d): %v\n", res.Meta.Kind, res.Meta.CreatedAt, res.Meta.SchemaVersion, res.SchemaAfter, res.Counts)
		_, _ = fmt.Fprintf(stdout, "the previous database is kept as %s — once everything looks right: ntb backup drop-old %s --yes\n", res.OldDatabase, res.OldDatabase)
		_, _ = fmt.Fprintln(stdout, "everyone must sign in again; passwords and MFA are those of the backup's date. Start the API: docker compose start api")
		return nil
	case "drop-old":
		if file == "" {
			names, err := svc.OldDatabases(ctx)
			if err != nil {
				return err
			}
			if len(names) == 0 {
				_, _ = fmt.Fprintln(stdout, "no database kept by a restore")
			}
			for _, n := range names {
				_, _ = fmt.Fprintln(stdout, n)
			}
			return nil
		}
		if !*yes {
			return errors.New("add --yes to drop " + file)
		}
		if err := svc.DropOld(ctx, file); err != nil {
			return err
		}
		_, _ = fmt.Fprintln(stdout, "dropped", file)
		return nil
	}
	_, _ = fmt.Fprintln(stderr, backupUsage)
	return fmt.Errorf("backup: unknown command %q", args[0])
}

func decryptFile(in, out, pass string, stdout io.Writer) error {
	src, err := os.Open(in)
	if err != nil {
		return fmt.Errorf("open: %w", err)
	}
	defer func() { _ = src.Close() }()
	dst, err := os.OpenFile(out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("create %s: %w", out, err)
	}
	w := bufio.NewWriter(dst)
	meta, err := backup.Decrypt(w, src, pass)
	if err == nil {
		err = w.Flush()
	}
	if cerr := dst.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(out)
		return err
	}
	_, _ = fmt.Fprintf(stdout, "wrote %s (pg_dump custom format; schema %d, made %s) — keep it private, it is not encrypted\n", out, meta.SchemaVersion, meta.CreatedAt)
	return nil
}

func listBackups(ctx context.Context, svc *backup.Service, stdout io.Writer) error {
	files, err := svc.Files()
	if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(stdout, "%s (%d backups)\n", svc.Cfg.Dir, len(files))
	for _, f := range files {
		info, _ := os.Stat(filepath.Join(svc.Cfg.Dir, f.Name))
		size := int64(0)
		if info != nil {
			size = info.Size()
		}
		key := "?"
		if fh, err := os.Open(filepath.Join(svc.Cfg.Dir, f.Name)); err == nil {
			if m, err := backup.ReadMeta(fh); err == nil {
				key = "same key"
				if m.KeyFingerprint != svc.Cfg.KeyFingerprint {
					key = "OTHER master key"
				}
			}
			_ = fh.Close()
		}
		_, _ = fmt.Fprintf(stdout, "  %s  %-11s %8d KiB  %s\n", f.At.Local().Format("2006-01-02 15:04"), f.Kind, size>>10, key)
	}
	runs, err := store.New(svc.Pool).ListBackupRuns(ctx, 10)
	if err != nil {
		return fmt.Errorf("backup runs: %w", err)
	}
	_, _ = fmt.Fprintln(stdout, "recent runs:")
	for _, r := range runs {
		line := fmt.Sprintf("  %s  %-11s %-7s %s", r.StartedAt.Time.Local().Format("2006-01-02 15:04"), r.Kind, r.Status, r.FileName)
		if r.Error != "" {
			line += "  " + r.Error
		}
		_, _ = fmt.Fprintln(stdout, line)
	}
	return nil
}
