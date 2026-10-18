-- Backup history (P2-13, ADR-053): one row per backup / verification run of the installation. System-level like users
-- and sessions (one database holds every organization), so no organization_id; only system admins read it.
CREATE TABLE backup_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            text NOT NULL CHECK (kind IN ('scheduled', 'manual', 'pre-upgrade')),
    status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    file_name       text NOT NULL DEFAULT '',
    size_bytes      bigint NOT NULL DEFAULT 0,
    sha256          text NOT NULL DEFAULT '',
    app_version     text NOT NULL DEFAULT '',
    schema_version  integer NOT NULL DEFAULT 0,
    key_fingerprint text NOT NULL DEFAULT '',
    pruned          integer NOT NULL DEFAULT 0,
    error           text NOT NULL DEFAULT '',
    verified_at     timestamptz,
    verify_error    text NOT NULL DEFAULT ''
);
CREATE INDEX backup_runs_started ON backup_runs (started_at DESC);
