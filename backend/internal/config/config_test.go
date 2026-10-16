package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	for _, key := range []string{"NTB_HTTP_ADDR", "NTB_VERSION", "NTB_ENV", "NTB_DATABASE_URL", "NTB_MIGRATE_ON_START"} {
		t.Setenv(key, "")
	}
	cfg := Load()
	if cfg.HTTPAddr != ":8069" || cfg.Version != "dev" || cfg.Env != "development" || cfg.MigrateOnStart {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
}

func TestLoadFromEnv(t *testing.T) {
	t.Setenv("NTB_HTTP_ADDR", ":9000")
	t.Setenv("NTB_DATABASE_URL", "postgres://u:p@db:5432/x")
	t.Setenv("NTB_MIGRATE_ON_START", "true")
	cfg := Load()
	if cfg.HTTPAddr != ":9000" || cfg.DatabaseURL != "postgres://u:p@db:5432/x" || !cfg.MigrateOnStart {
		t.Fatalf("env not applied: %+v", cfg)
	}
}

func TestInvalidBoolFallsBack(t *testing.T) {
	t.Setenv("NTB_MIGRATE_ON_START", "yes-please")
	if Load().MigrateOnStart {
		t.Fatal("invalid bool should fall back to false")
	}
}
