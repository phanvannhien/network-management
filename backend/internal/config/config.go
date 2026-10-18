// Package config loads runtime settings from environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
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
	// Timezone is the calendar of the installation (expiry dates, the 07:00 alert digest) when TZ is not set;
	// containers run on UTC otherwise.
	Timezone string
	// MasterKeyVersion numbers the master key (each rotation bumps it; stored with every secret). Raw text, checked
	// at startup (a typo must not silently mean version 1).
	MasterKeyVersion string
	// MasterKey is the base64 32-byte key for envelope encryption of secrets (required; ADR-018).
	MasterKey string
	// TrustedProxies are CIDRs whose X-Forwarded-For / X-Forwarded-Proto headers are honoured
	// (loopback for the Vite dev proxy; Compose adds the Docker network for nginx).
	TrustedProxies string
}

// Load reads settings from the environment, falling back to dev defaults.
func Load() Config {
	return Config{
		HTTPAddr:         getenv("NTB_HTTP_ADDR", ":8069"),
		Version:          getenv("NTB_VERSION", "dev"),
		Env:              getenv("NTB_ENV", "development"),
		DatabaseURL:      getenv("NTB_DATABASE_URL", "postgres://ntb:ntb_dev_password@localhost:5468/ntb?sslmode=disable"),
		MigrateOnStart:   getbool("NTB_MIGRATE_ON_START", false),
		TrustedProxies:   getenv("NTB_TRUSTED_PROXIES", "127.0.0.1/32,::1/128"),
		Timezone:         getenv("NTB_TIMEZONE", "Asia/Ho_Chi_Minh"),
		MasterKeyVersion: getenv("NTB_MASTER_KEY_VERSION", "1"),
		MasterKey:        os.Getenv("NTB_MASTER_KEY"), // no default: the server refuses to start without it
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

// KeyVersion parses MasterKeyVersion: a whole number from 1 to 32767.
func (c Config) KeyVersion() (int16, error) {
	v, err := strconv.Atoi(strings.TrimSpace(c.MasterKeyVersion))
	if err != nil || v < 1 || v > 32767 {
		return 0, fmt.Errorf("NTB_MASTER_KEY_VERSION must be a whole number from 1 to 32767, got %q", c.MasterKeyVersion)
	}
	return int16(v), nil
}
