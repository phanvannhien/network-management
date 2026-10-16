package database_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/database"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/testdb"
)

func TestConnectAndMigrate(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	for _, table := range []string{"organizations", "users", "memberships", "sessions", "audit_log"} {
		var exists bool
		err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)`, table,
		).Scan(&exists)
		if err != nil {
			t.Fatalf("check table %s: %v", table, err)
		}
		if !exists {
			t.Errorf("table %s missing after migrate up", table)
		}
	}
}

func TestMigrateDownThenUp(t *testing.T) {
	pool, dbURL := testdb.New(t)
	ctx := context.Background()

	if err := database.MigrateDown(dbURL); err != nil {
		t.Fatalf("migrate down: %v", err)
	}
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM information_schema.tables WHERE table_name = 'organizations'`,
	).Scan(&count); err != nil {
		t.Fatalf("count tables: %v", err)
	}
	if count != 0 {
		t.Fatalf("organizations still exists after migrate down")
	}
	if err := database.MigrateUp(dbURL); err != nil {
		t.Fatalf("migrate up again: %v", err)
	}
}

func TestSchemaConstraints(t *testing.T) {
	pool, _ := testdb.New(t)
	ctx := context.Background()

	var orgID, userID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO organizations (name, kind) VALUES ('Văn phòng mẫu', 'internal') RETURNING id`,
	).Scan(&orgID); err != nil {
		t.Fatalf("insert organization: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash) VALUES ('Admin@Example.com', 'x') RETURNING id`,
	).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	t.Run("email is case-insensitive unique", func(t *testing.T) {
		_, err := pool.Exec(ctx, `INSERT INTO users (email, password_hash) VALUES ('admin@example.com', 'y')`)
		expectSQLState(t, err, "23505") // unique_violation
	})

	t.Run("membership role is restricted", func(t *testing.T) {
		_, err := pool.Exec(ctx,
			`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'superuser')`, orgID, userID)
		expectSQLState(t, err, "23514") // check_violation
	})

	t.Run("one membership per user per organization", func(t *testing.T) {
		if _, err := pool.Exec(ctx,
			`INSERT INTO memberships (organization_id, user_id, role, permissions)
			 VALUES ($1, $2, 'owner', '{credential.reveal}')`, orgID, userID); err != nil {
			t.Fatalf("insert membership: %v", err)
		}
		_, err := pool.Exec(ctx,
			`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'viewer')`, orgID, userID)
		expectSQLState(t, err, "23505")
	})

	t.Run("unknown permission is rejected", func(t *testing.T) {
		_, err := pool.Exec(ctx,
			`UPDATE memberships SET permissions = '{root.everything}' WHERE organization_id = $1`, orgID)
		expectSQLState(t, err, "23514")
	})

	t.Run("updated_at trigger fires", func(t *testing.T) {
		var changed bool
		if err := pool.QueryRow(ctx,
			`UPDATE organizations SET name = 'Đổi tên', updated_at = '2000-01-01' WHERE id = $1
			 RETURNING updated_at > '2000-01-02'`, orgID,
		).Scan(&changed); err != nil {
			t.Fatalf("update organization: %v", err)
		}
		if !changed {
			t.Fatal("updated_at was not refreshed by the trigger")
		}
	})

	t.Run("audit_log is append-only", func(t *testing.T) {
		if _, err := pool.Exec(ctx,
			`INSERT INTO audit_log (organization_id, actor_user_id, action, object_type, object_id)
			 VALUES ($1::uuid, $2, 'organization.update', 'organization', $1::text)`, orgID, userID); err != nil {
			t.Fatalf("insert audit row: %v", err)
		}
		_, err := pool.Exec(ctx, `UPDATE audit_log SET action = 'tampered'`)
		expectSQLState(t, err, "P0001") // raise_exception
		_, err = pool.Exec(ctx, `DELETE FROM audit_log`)
		expectSQLState(t, err, "P0001")
	})
}

func expectSQLState(t *testing.T, err error, code string) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected Postgres error %s, got %v", code, err)
	}
	if pgErr.Code != code {
		t.Fatalf("expected SQLSTATE %s, got %s (%s)", code, pgErr.Code, pgErr.Message)
	}
}
