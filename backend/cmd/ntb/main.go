package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // timezone database inside the binary (alpine images have none)

	"golang.org/x/term"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/catalog"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/config"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/database"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/notify"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/rotate"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/secrets"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

const usage = `usage:
  ntb                                   run the API server
  ntb admin create --email E [--name N] create a system admin; password is read from stdin
  ntb seed demo --owner E               create the sample organization "Tập đoàn Mẫu" owned by system admin E
  ntb seed bench --owner E --devices N  create an organization with N devices on one diagram (performance checks)
  ntb rotate-master-key                 move every stored secret from NTB_MASTER_KEY to NTB_NEW_MASTER_KEY`

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	var err error
	switch {
	case len(os.Args) == 1:
		err = serve(logger)
	case len(os.Args) >= 3 && os.Args[1] == "admin" && os.Args[2] == "create":
		err = adminCreate(logger, os.Args[3:], os.Stdin, os.Stderr)
	case len(os.Args) >= 3 && os.Args[1] == "seed" && (os.Args[2] == "demo" || os.Args[2] == "bench"):
		err = seed(logger, os.Args[2], os.Args[3:], os.Stderr)
	case len(os.Args) == 2 && os.Args[1] == "rotate-master-key":
		err = rotateMasterKey(os.Stderr)
	default:
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		logger.Error("ntb failed", "error", err)
		os.Exit(1)
	}
}

func serve(logger *slog.Logger) error {
	cfg := config.Load()
	// Calendar days (expiry dates, the 07:00 digest) follow the installation's timezone; TZ, when set, wins.
	if os.Getenv("TZ") == "" {
		loc, err := time.LoadLocation(cfg.Timezone)
		if err != nil {
			return fmt.Errorf("NTB_TIMEZONE: %w", err)
		}
		time.Local = loc
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if cfg.MigrateOnStart {
		logger.Info("applying database migrations")
		if err := database.MigrateUp(cfg.DatabaseURL); err != nil {
			return fmt.Errorf("migrate on start: %w", err)
		}
	}

	// The pool connects lazily: the API starts even when Postgres is down and /api/healthz reports it.
	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("configure database pool: %w", err)
	}
	defer pool.Close()
	// Bounded: a database that accepts the connection but never answers must not keep the API from listening.
	pingCtx, cancelPing := context.WithTimeout(ctx, 5*time.Second)
	if err := pool.Ping(pingCtx); err != nil {
		logger.Warn("database not reachable at startup", "error", err)
	}
	cancelPing()

	// The built-in catalog (data + photos) is checked once: a packaging mistake stops the release here, not later.
	if err := catalog.Load(); err != nil {
		return fmt.Errorf("device catalog: %w", err)
	}

	masterKey, err := secrets.ParseMasterKey(cfg.MasterKey)
	if err != nil {
		return err
	}
	keyVersion, err := cfg.KeyVersion()
	if err != nil {
		return err
	}
	keys, err := secrets.NewKeyringVersion(masterKey, keyVersion)
	if err != nil {
		return err
	}
	// The key version must be the one stored secrets use (a rotation half applied would lock everyone out).
	checkCtx, cancelCheck := context.WithTimeout(ctx, 10*time.Second)
	if err := rotate.CheckVersions(checkCtx, store.New(pool), keys); err != nil && !errors.Is(err, context.DeadlineExceeded) {
		cancelCheck()
		return err
	}
	cancelCheck()

	resolver, err := auth.NewClientIPResolver(cfg.TrustedProxies)
	if err != nil {
		return fmt.Errorf("NTB_TRUSTED_PROXIES: %w", err)
	}
	queries := store.New(pool)
	authSvc, err := auth.NewService(pool, keys, logger, auth.DefaultArgon2)
	if err != nil {
		return fmt.Errorf("init auth: %w", err)
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           api.NewRouter(logger, api.NewServer(logger, queries, pool, authSvc, cfg.Version, cfg.Env), resolver),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go cleanupExpiredSessions(ctx, logger, queries)
	// Expiry alerts (P2-05): notifications hourly, one digest e-mail a day per organization.
	go notify.Runner{Pool: pool, Keys: keys, Send: notify.SendSMTP, Logger: logger}.Loop(ctx)

	errCh := make(chan error, 1)
	go func() {
		logger.Info("http server listening", "addr", cfg.HTTPAddr, "version", cfg.Version)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- fmt.Errorf("listen: %w", err)
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	return nil
}

// cleanupExpiredSessions deletes expired sessions hourly until ctx is cancelled.
func cleanupExpiredSessions(ctx context.Context, logger *slog.Logger, q *store.Queries) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			n, err := q.DeleteExpiredSessions(ctx)
			if err != nil {
				logger.Warn("delete expired sessions", "error", err)
			} else if n > 0 {
				logger.Info("deleted expired sessions", "count", n)
			}
		}
	}
}

// adminCreate creates the first system admin (P1-01). The password never appears in shell history or the
// process list: typed at a hidden prompt (twice) on a terminal, or piped: `ntb admin create --email a@b.c < pw.txt`.
func adminCreate(logger *slog.Logger, args []string, stdin *os.File, stderr io.Writer) error {
	fs := flag.NewFlagSet("admin create", flag.ContinueOnError)
	fs.SetOutput(stderr)
	email := fs.String("email", "", "admin email (required)")
	name := fs.String("name", "", "display name")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*email) == "" {
		return errors.New("--email is required")
	}

	password, err := readPassword(stdin, stderr, *email)
	if err != nil {
		return err
	}

	cfg := config.Load()
	ctx := context.Background()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	// No keyring: creating a user never touches encrypted secrets, so the CLI works before NTB_MASTER_KEY is set.
	svc, err := auth.NewService(pool, nil, logger, auth.DefaultArgon2)
	if err != nil {
		return err
	}
	user, err := svc.CreateUser(ctx, *email, *name, password, true)
	if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(stderr, "Created system admin %s (%x)\n", user.Email, user.ID.Bytes)
	return nil
}

// seed writes the sample organization or a benchmark inventory (P1-25) through the API's own handlers, acting as the
// given system admin (owner of the new organization; every write is in its audit log).
func seed(logger *slog.Logger, what string, args []string, stderr io.Writer) error {
	fs := flag.NewFlagSet("seed "+what, flag.ContinueOnError)
	fs.SetOutput(stderr)
	owner := fs.String("owner", "", "email of a system admin, owner of the new organization (required)")
	devices := fs.Int("devices", 500, "bench: number of devices")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*owner) == "" {
		return errors.New("--owner is required")
	}
	cfg := config.Load()
	ctx := context.Background()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	svc, err := auth.NewService(pool, nil, logger, auth.DefaultArgon2)
	if err != nil {
		return err
	}
	srv := api.NewServer(logger, store.New(pool), pool, svc, cfg.Version, cfg.Env)
	started := time.Now()
	var res api.SeedResult
	if what == "demo" {
		res, err = srv.SeedDemo(ctx, *owner)
	} else {
		res, err = srv.SeedBench(ctx, *owner, *devices)
	}
	if err != nil {
		return err
	}
	for _, w := range res.Warnings {
		_, _ = fmt.Fprintln(stderr, "warning:", w)
	}
	_, _ = fmt.Fprintf(stderr, "Created %s (%s): %d devices, %d links, diagrams %s — %s\n",
		res.OrgName, res.OrgID, res.Devices, res.Links, strings.Join(res.Diagrams, ", "), time.Since(started).Round(time.Millisecond))
	return nil
}

// readPassword prompts without echo on a terminal (ADR-022, golang.org/x/term) and asks for confirmation;
// when stdin is a pipe or file it reads a single line instead.
func readPassword(stdin *os.File, stderr io.Writer, email string) (string, error) {
	fd := int(stdin.Fd())
	if !term.IsTerminal(fd) {
		line, err := bufio.NewReader(stdin).ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return "", fmt.Errorf("read password: %w", err)
		}
		return strings.TrimRight(line, "\r\n"), nil
	}
	_, _ = fmt.Fprintf(stderr, "Password for %s (min %d chars): ", email, auth.MinPasswordLength)
	first, err := term.ReadPassword(fd)
	_, _ = fmt.Fprintln(stderr)
	if err != nil {
		return "", fmt.Errorf("read password: %w", err)
	}
	_, _ = fmt.Fprint(stderr, "Repeat password: ")
	second, err := term.ReadPassword(fd)
	_, _ = fmt.Fprintln(stderr)
	if err != nil {
		return "", fmt.Errorf("read password: %w", err)
	}
	if string(first) != string(second) {
		return "", errors.New("passwords do not match")
	}
	return string(first), nil
}

// rotateMasterKey re-wraps every stored secret (credentials, cloud accounts, TOTP seeds, SMTP password) from the
// current master key (NTB_MASTER_KEY, version NTB_MASTER_KEY_VERSION) to NTB_NEW_MASTER_KEY with the next version,
// in one transaction. Stop the API first; afterwards start it with the new key and version.
func rotateMasterKey(stderr io.Writer) error {
	cfg := config.Load()
	oldKey, err := secrets.ParseMasterKey(cfg.MasterKey)
	if err != nil {
		return err
	}
	newKey, err := secrets.ParseMasterKey(os.Getenv("NTB_NEW_MASTER_KEY"))
	if err != nil {
		return fmt.Errorf("NTB_NEW_MASTER_KEY: %w", err)
	}
	if bytes.Equal(oldKey, newKey) {
		return errors.New("NTB_NEW_MASTER_KEY is the same as NTB_MASTER_KEY")
	}
	oldVersion, err := cfg.KeyVersion()
	if err != nil {
		return err
	}
	if oldVersion == 32767 {
		return errors.New("NTB_MASTER_KEY_VERSION is at its maximum")
	}
	old, err := secrets.NewKeyringVersion(oldKey, oldVersion)
	if err != nil {
		return err
	}
	next, err := secrets.NewKeyringVersion(newKey, oldVersion+1)
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("configure database pool: %w", err)
	}
	defer pool.Close()
	n, err := rotate.Run(ctx, pool, old, next)
	if err != nil {
		return fmt.Errorf("rotation aborted, nothing changed: %w", err)
	}
	_, _ = fmt.Fprintf(stderr, "Moved %d credentials, %d cloud accounts, %d MFA seeds, %d SMTP password to master key version %d.\n"+
		"Now set NTB_MASTER_KEY to the new key and NTB_MASTER_KEY_VERSION=%d, then start the API. Keep the old key until you have checked.\n",
		n.Credentials, n.CloudAccounts, n.TOTP, n.SMTP, next.Version(), next.Version())
	return nil
}
