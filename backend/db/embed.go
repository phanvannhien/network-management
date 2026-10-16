// Package db embeds the SQL migrations so the binary and tests can apply them without files on disk.
package db

import "embed"

// Migrations holds db/migrations/*.sql (golang-migrate naming: NNNNNN_name.up.sql / .down.sql).
//
//go:embed migrations/*.sql
var Migrations embed.FS
