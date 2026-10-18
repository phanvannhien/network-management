-- Backup destinations (P2-13, ADR-053): where each good backup is copied (rclone). System-level like backup_runs; only
-- system admins manage them. Secrets (passwords, keys, OAuth tokens) are one sealed JSON (AAD "backup_target:<id>").
CREATE TABLE backup_targets (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text NOT NULL CHECK (btrim(name) <> ''),
    kind               text NOT NULL CHECK (kind IN ('local', 'sftp', 's3', 'drive', 'onedrive', 'dropbox')),
    enabled            boolean NOT NULL DEFAULT true,
    settings           jsonb NOT NULL DEFAULT '{}',
    secret_ciphertext  bytea,
    secret_wrapped_dek bytea,
    secret_key_version smallint,
    keep               text NOT NULL DEFAULT '7,4,12',
    last_status        text NOT NULL DEFAULT '' CHECK (last_status IN ('', 'ok', 'failed')),
    last_at            timestamptz,
    last_file          text NOT NULL DEFAULT '',
    last_error         text NOT NULL DEFAULT '',
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    version            integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX backup_targets_name ON backup_targets (lower(name));
