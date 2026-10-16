package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/netip"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/testdb"
)

func newTestService(t *testing.T) (*Service, *store.Queries, *pgxpool.Pool) {
	t.Helper()
	pool, _ := testdb.New(t)
	q := store.New(pool)
	svc, err := NewService(q, slog.New(slog.DiscardHandler), cheapArgon)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	return svc, q, pool
}

var meta = RequestMeta{IP: netip.MustParseAddr("198.51.100.9"), UserAgent: "test", RequestID: "r1"}

func TestLockoutAfterRepeatedFailures(t *testing.T) {
	svc, q, pool := newTestService(t)
	ctx := context.Background()
	user, err := svc.CreateUser(ctx, "lock@example.com", "Lock", "a-strong-password", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	// Move the rate-limit clock forward between attempts so lockout (not rate limiting) is what we test.
	clock := time.Now()
	svc.idLimit.now = func() time.Time { return clock }
	svc.ipLimit.now = func() time.Time { return clock }

	for i := 0; i < MaxFailedLogins; i++ {
		clock = clock.Add(time.Minute)
		if _, err := svc.Login(ctx, "lock@example.com", "wrong", meta); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("attempt %d: want ErrInvalidCredentials, got %v", i+1, err)
		}
	}
	clock = clock.Add(time.Minute)
	if _, err := svc.Login(ctx, "lock@example.com", "a-strong-password", meta); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("locked account accepted the correct password: %v", err)
	}

	// Simulate the lock expiring; the correct password works again and the counter resets.
	if _, err := pool.Exec(ctx, `UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`, user.ID); err != nil {
		t.Fatalf("expire lock: %v", err)
	}
	clock = clock.Add(time.Minute)
	if _, err := svc.Login(ctx, "lock@example.com", "a-strong-password", meta); err != nil {
		t.Fatalf("login after lock expiry: %v", err)
	}
	reloaded, _ := q.GetUserByID(ctx, user.ID)
	if reloaded.FailedLoginCount != 0 || reloaded.LockedUntil.Valid {
		t.Fatalf("counter not reset: %+v", reloaded)
	}
}

func TestRateLimitPerEmail(t *testing.T) {
	svc, _, _ := newTestService(t)
	ctx := context.Background()
	var lastErr error
	for i := 0; i < 6; i++ {
		_, lastErr = svc.Login(ctx, "nobody@example.com", "x", meta)
	}
	if !errors.Is(lastErr, ErrRateLimited) {
		t.Fatalf("6th attempt within a minute: want ErrRateLimited, got %v", lastErr)
	}
}

func TestSessionLifecycle(t *testing.T) {
	svc, _, pool := newTestService(t)
	ctx := context.Background()
	if _, err := svc.CreateUser(ctx, "s@example.com", "S", "a-strong-password", true); err != nil {
		t.Fatalf("create user: %v", err)
	}
	res, err := svc.Login(ctx, "S@Example.com", "a-strong-password", meta) // email is case-insensitive
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	sess, err := svc.Lookup(ctx, res.Token)
	if err != nil || sess.Email != "s@example.com" || !sess.IsSystemAdmin || sess.CSRFToken == "" {
		t.Fatalf("lookup: %+v err=%v", sess, err)
	}

	// The database stores only the token hash, never the cookie value.
	var stored int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM sessions WHERE token_hash = $1`, []byte(res.Token)).Scan(&stored); err != nil {
		t.Fatalf("query: %v", err)
	}
	if stored != 0 {
		t.Fatal("raw session token found in the database")
	}

	if err := svc.Logout(ctx, sess, meta); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if _, err := svc.Lookup(ctx, res.Token); !errors.Is(err, ErrNoSession) {
		t.Fatalf("session still valid after logout: %v", err)
	}
}

func TestExpiredSessionRejected(t *testing.T) {
	svc, _, pool := newTestService(t)
	ctx := context.Background()
	_, _ = svc.CreateUser(ctx, "e@example.com", "E", "a-strong-password", false)
	res, err := svc.Login(ctx, "e@example.com", "a-strong-password", meta)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE sessions SET expires_at = now() - interval '1 second'`); err != nil {
		t.Fatalf("expire: %v", err)
	}
	if _, err := svc.Lookup(ctx, res.Token); !errors.Is(err, ErrNoSession) {
		t.Fatalf("expired session accepted: %v", err)
	}
}

func TestCreateUserRejectsShortPassword(t *testing.T) {
	svc, _, _ := newTestService(t)
	if _, err := svc.CreateUser(context.Background(), "x@example.com", "", "short", false); err == nil {
		t.Fatal("short password accepted")
	}
}

func TestAuditNeverContainsPassword(t *testing.T) {
	svc, _, pool := newTestService(t)
	ctx := context.Background()
	_, _ = svc.CreateUser(ctx, "a@example.com", "A", "super-secret-password", false)
	_, _ = svc.Login(ctx, "a@example.com", "super-secret-wrong", meta)
	_, _ = svc.Login(ctx, "A@EXAMPLE.com", "super-secret-password", meta) // typed in another case

	// Audit uses the stored (canonical) email, not whatever casing was typed.
	var odd int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_log WHERE object_id <> 'a@example.com'`).Scan(&odd); err != nil {
		t.Fatalf("query: %v", err)
	}
	if odd != 0 {
		t.Fatal("audit object_id does not use the canonical email")
	}

	var actions []string
	rows, err := pool.Query(ctx, `SELECT action FROM audit_log ORDER BY id`)
	if err != nil {
		t.Fatalf("query audit: %v", err)
	}
	for rows.Next() {
		var a string
		_ = rows.Scan(&a)
		actions = append(actions, a)
	}
	want := []string{"user.create", "auth.login_failed", "auth.login"}
	if len(actions) != len(want) {
		t.Fatalf("audit actions = %v, want %v", actions, want)
	}
	for i := range want {
		if actions[i] != want[i] {
			t.Fatalf("audit actions = %v, want %v", actions, want)
		}
	}
	var leaked int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_log WHERE audit_log::text LIKE '%super-secret%'`).Scan(&leaked); err != nil {
		t.Fatalf("query: %v", err)
	}
	if leaked != 0 {
		t.Fatal("password text found in audit_log")
	}
}
