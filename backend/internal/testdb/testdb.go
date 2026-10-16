// Package testdb gives integration tests a fresh, migrated Postgres database.
//
// Tests connect through NTB_TEST_DATABASE_URL (any database on the target server; `make test`
// points it at the Compose `db`). Each call creates a uniquely named database, applies all
// migrations and drops it when the test ends, so tests never share or pollute data.
package testdb

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/database"
)

// EnvVar names the admin connection string used to create throwaway databases.
const EnvVar = "NTB_TEST_DATABASE_URL"

// New returns a pool connected to a freshly created and migrated database.
// It fails (not skips) when NTB_TEST_DATABASE_URL is set but unreachable, and skips when unset.
func New(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	adminURL := os.Getenv(EnvVar)
	if adminURL == "" {
		t.Skipf("%s not set; start Postgres with `docker compose -f deploy/docker-compose.yml up -d db` and use `make test`", EnvVar)
	}
	ctx := context.Background()

	admin, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatalf("connect admin database: %v", err)
	}
	defer func() { _ = admin.Close(ctx) }()

	name := "ntb_test_" + randomSuffix(t)
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
		t.Fatalf("create test database: %v", err)
	}

	dbURL := withDatabase(t, adminURL, name)
	t.Cleanup(func() {
		cleanupCtx := context.Background()
		conn, err := pgx.Connect(cleanupCtx, adminURL)
		if err != nil {
			t.Errorf("connect for cleanup: %v", err)
			return
		}
		defer func() { _ = conn.Close(cleanupCtx) }()
		if _, err := conn.Exec(cleanupCtx, "DROP DATABASE IF EXISTS "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)"); err != nil {
			t.Errorf("drop test database: %v", err)
		}
	})

	if err := database.MigrateUp(dbURL); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}
	pool, err := database.Open(ctx, dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool, dbURL
}

func randomSuffix(t *testing.T) string {
	t.Helper()
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("random suffix: %v", err)
	}
	return hex.EncodeToString(b)
}

func withDatabase(t *testing.T, rawURL, name string) string {
	t.Helper()
	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse %s: %v", EnvVar, err)
	}
	u.Path = "/" + name
	return u.String()
}
