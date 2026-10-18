-- Backup history (P2-13, ADR-053). System-level: no organization.

-- name: StartBackupRun :one
INSERT INTO backup_runs (kind, app_version, schema_version, key_fingerprint)
VALUES (@kind, @app_version, @schema_version, @key_fingerprint)
RETURNING id;

-- name: FinishBackupRun :exec
UPDATE backup_runs
SET status = @status, finished_at = now(), file_name = @file_name, size_bytes = @size_bytes, sha256 = @sha256,
    pruned = @pruned, error = @error
WHERE id = @id;

-- name: MarkBackupVerified :exec
UPDATE backup_runs SET verified_at = now(), verify_error = @verify_error WHERE file_name = @file_name AND status = 'ok';

-- name: ListBackupRuns :many
SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT @lim;

-- name: LastGoodBackup :one
SELECT * FROM backup_runs WHERE status = 'ok' ORDER BY started_at DESC LIMIT 1;

-- name: FailStaleBackupRuns :exec
-- Runs left "running" by a process that died (crash, restart) are marked failed.
UPDATE backup_runs SET status = 'failed', finished_at = now(), error = 'interrupted'
WHERE status = 'running' AND started_at < now() - interval '6 hours';

-- name: LastBackupOfKind :one
-- The newest run of a kind (any status): the scheduler's "done today?" and "failed a moment ago?".
SELECT * FROM backup_runs WHERE kind = @kind ORDER BY started_at DESC LIMIT 1;

-- name: LastGoodBackupOfKind :one
SELECT * FROM backup_runs WHERE kind = @kind AND status = 'ok' ORDER BY started_at DESC LIMIT 1;

-- name: ListBackupTargets :many
SELECT * FROM backup_targets ORDER BY lower(name);

-- name: GetBackupTarget :one
SELECT * FROM backup_targets WHERE id = @id;

-- name: CreateBackupTarget :one
INSERT INTO backup_targets (id, name, kind, enabled, settings, secret_ciphertext, secret_wrapped_dek, secret_key_version, keep)
VALUES (@id, @name, @kind, @enabled, @settings, @secret_ciphertext, @secret_wrapped_dek, @secret_key_version, @keep)
RETURNING *;

-- name: UpdateBackupTarget :one
UPDATE backup_targets
SET name = @name, enabled = @enabled, settings = @settings, secret_ciphertext = @secret_ciphertext,
    secret_wrapped_dek = @secret_wrapped_dek, secret_key_version = @secret_key_version, keep = @keep,
    updated_at = now(), version = version + 1
WHERE id = @id AND version = @version
RETURNING *;

-- name: DeleteBackupTarget :execrows
DELETE FROM backup_targets WHERE id = @id;

-- name: RecordBackupTargetResult :exec
-- previous status is returned by the caller's read; the scheduler e-mails on a change to failed.
UPDATE backup_targets SET last_status = @last_status, last_at = now(), last_file = @last_file, last_error = @last_error
WHERE id = @id;

-- name: SaveBackupTargetSecret :execrows
-- A refreshed OAuth token (rclone rotates some) replaces the sealed secret without touching the rest.
-- Only over the secret it was refreshed from: a token pasted meanwhile is not overwritten.
UPDATE backup_targets SET secret_ciphertext = @secret_ciphertext, secret_wrapped_dek = @secret_wrapped_dek,
    secret_key_version = @secret_key_version
WHERE id = @id AND secret_wrapped_dek = @old_wrapped_dek;

-- name: BackupAlertRecipients :many
-- System admins who can sign in: they receive backup failure e-mails.
SELECT email FROM users WHERE is_system_admin AND disabled_at IS NULL ORDER BY email;
