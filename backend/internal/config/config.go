// Package config loads runtime settings from environment variables.
package config

import "os"

// Config holds process-wide settings.
type Config struct {
	// HTTPAddr is the listen address, e.g. ":8069".
	HTTPAddr string
	// Version is reported by /api/healthz.
	Version string
	// DatabaseURL is the Postgres connection string (dev default: Compose db on localhost:5468).
	DatabaseURL string
}

// Load reads settings from the environment, falling back to dev defaults.
func Load() Config {
	return Config{
		HTTPAddr:    getenv("NTB_HTTP_ADDR", ":8069"),
		Version:     getenv("NTB_VERSION", "dev"),
		DatabaseURL: getenv("NTB_DATABASE_URL", "postgres://ntb:ntb_dev_password@localhost:5468/ntb?sslmode=disable"),
	}
}

func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
