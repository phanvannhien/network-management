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
