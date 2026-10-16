// Package config loads runtime settings from environment variables.
package config

import (
	"os"
	"strconv"
)

// Config holds process-wide settings.
type Config struct {
	// HTTPAddr is the listen address, e.g. ":8069".
	HTTPAddr string
	// Version is reported by /api/healthz.
	Version string
	// Env names the deployment ("production", "staging", "development"); the UI shows a badge unless production.
	Env string
	// DatabaseURL is the Postgres connection string (dev default: Compose db on localhost:5468).
	DatabaseURL string
	// MigrateOnStart applies pending migrations before serving (enabled in Docker Compose).
	MigrateOnStart bool
	// MasterKey is the base64 32-byte key for envelope encryption of secrets (required; ADR-018).
	MasterKey string
	// TrustedProxies are CIDRs whose X-Forwarded-For / X-Forwarded-Proto headers are honoured
	// (loopback for the Vite dev proxy; Compose adds the Docker network for nginx).
	TrustedProxies string
}

// Load reads settings from the environment, falling back to dev defaults.
func Load() Config {
	return Config{
		HTTPAddr:       getenv("NTB_HTTP_ADDR", ":8069"),
		Version:        getenv("NTB_VERSION", "dev"),
		Env:            getenv("NTB_ENV", "development"),
		DatabaseURL:    getenv("NTB_DATABASE_URL", "postgres://ntb:ntb_dev_password@localhost:5468/ntb?sslmode=disable"),
		MigrateOnStart: getbool("NTB_MIGRATE_ON_START", false),
		TrustedProxies: getenv("NTB_TRUSTED_PROXIES", "127.0.0.1/32,::1/128"),
		MasterKey:      os.Getenv("NTB_MASTER_KEY"), // no default: the server refuses to start without it
	}
}

func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func getbool(key string, fallback bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}
