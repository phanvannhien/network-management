package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/testdb"
)

type fakePinger struct{ err error }

func (f fakePinger) Ping(context.Context) (int32, error) { return 1, f.err }

func get(t *testing.T, h http.Handler, path string) (int, map[string]string) {
	t.Helper()
	srv := httptest.NewServer(h)
	defer srv.Close()
	resp, err := http.Get(srv.URL + path)
	if err != nil {
		t.Fatalf("get %s: %v", path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	var body map[string]string
	_ = json.NewDecoder(resp.Body).Decode(&body)
	return resp.StatusCode, body
}

func newTestRouter(db Pinger) http.Handler {
	logger := slog.New(slog.DiscardHandler)
	return NewRouter(logger, NewServer(logger, db, "test"))
}

func TestHealthzOK(t *testing.T) {
	status, body := get(t, newTestRouter(fakePinger{}), "/api/healthz")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	want := map[string]string{"status": "ok", "version": "test", "database": "ok"}
	for k, v := range want {
		if body[k] != v {
			t.Errorf("body[%q] = %q, want %q", k, body[k], v)
		}
	}
}

func TestHealthzDatabaseDown(t *testing.T) {
	status, body := get(t, newTestRouter(fakePinger{err: errors.New("connection refused")}), "/api/healthz")
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", status)
	}
	if body["status"] != "degraded" || body["database"] != "unavailable" {
		t.Fatalf("body = %v, want degraded/unavailable", body)
	}
}

// End-to-end through sqlc and a real Postgres (OpenAPI → strict handler → sqlc → DB).
func TestHealthzWithRealDatabase(t *testing.T) {
	pool, _ := testdb.New(t)
	status, body := get(t, newTestRouter(store.New(pool)), "/api/healthz")
	if status != http.StatusOK || body["database"] != "ok" {
		t.Fatalf("status = %d body = %v, want 200 with database=ok", status, body)
	}
}

func TestUnknownRouteIs404(t *testing.T) {
	status, _ := get(t, newTestRouter(fakePinger{}), "/api/does-not-exist")
	if status != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", status)
	}
}
