package main

import (
	"bufio"
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

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/term"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/config"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/database"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/secrets"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

const usage = `usage:
  ntb                                   run the API server
  ntb admin create --email E [--name N] create a system admin; password is read from stdin`

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	var err error
	switch {
	case len(os.Args) == 1:
		err = serve(logger)
	case len(os.Args) >= 3 && os.Args[1] == "admin" && os.Args[2] == "create":
		err = adminCreate(logger, os.Args[3:], os.Stdin, os.Stderr)
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
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if cfg.MigrateOnStart {
		logger.Info("applying database migrations")
		if err := database.MigrateUp(cfg.DatabaseURL); err != nil {
			return fmt.Errorf("migrate on start: %w", err)
		}
	}

	// The pool connects lazily: the API starts even when Postgres is down and /api/healthz reports it.
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("configure database pool: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		logger.Warn("database not reachable at startup", "error", err)
	}

	masterKey, err := secrets.ParseMasterKey(cfg.MasterKey)
	if err != nil {
		return err
	}
	keys, err := secrets.NewKeyring(masterKey)
	if err != nil {
		return err
	}

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
		Handler:           api.NewRouter(logger, api.NewServer(logger, queries, authSvc, cfg.Version), resolver),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go cleanupExpiredSessions(ctx, logger, queries)

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
