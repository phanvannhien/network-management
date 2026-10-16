package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthz(t *testing.T) {
	logger := slog.New(slog.DiscardHandler)
	srv := httptest.NewServer(NewRouter(logger, "test"))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/healthz")
	if err != nil {
		t.Fatalf("get healthz: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "ok" || body["version"] != "test" {
		t.Fatalf("body = %v, want status=ok version=test", body)
	}
}

func TestUnknownRouteIs404(t *testing.T) {
	logger := slog.New(slog.DiscardHandler)
	srv := httptest.NewServer(NewRouter(logger, "test"))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/does-not-exist")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}
