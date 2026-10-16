-- Users and sessions are global (not tenant-scoped): a user can belong to several organizations.

-- name: CreateUser :one
INSERT INTO users (email, display_name, password_hash, is_system_admin)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: RecordLoginFailure :one
-- Increments the failure counter and locks the account once it reaches the threshold.
UPDATE users
SET failed_login_count = failed_login_count + 1,
    locked_until = CASE
      WHEN failed_login_count + 1 >= sqlc.arg(max_failures)::int
        THEN now() + make_interval(secs => sqlc.arg(lock_seconds)::int)
      ELSE locked_until
    END
WHERE id = sqlc.arg(id)
RETURNING failed_login_count, locked_until;

-- name: ResetLoginFailures :exec
UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1;

-- name: CreateSession :exec
INSERT INTO sessions (token_hash, user_id, csrf_token, ip, user_agent, expires_at)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: GetSession :one
-- Returns the live session joined with its (enabled) user and MFA state.
SELECT s.token_hash, s.csrf_token, s.created_at, s.last_seen_at, s.expires_at, s.mfa_verified_at,
       u.id AS user_id, u.email, u.display_name, u.is_system_admin,
       (t.enabled_at IS NOT NULL)::boolean AS mfa_enabled,
       (u.is_system_admin OR EXISTS (
          SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.role IN ('owner', 'admin')
        ))::boolean AS mfa_required
FROM sessions s
JOIN users u ON u.id = s.user_id
LEFT JOIN mfa_totp t ON t.user_id = u.id
WHERE s.token_hash = $1
  AND s.expires_at > now()
  AND u.disabled_at IS NULL;

-- name: TouchSession :exec
UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE token_hash = $1;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE token_hash = $1;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions WHERE expires_at <= now();

-- name: InsertAuditLog :exec
INSERT INTO audit_log (organization_id, actor_user_id, action, object_type, object_id, before, after, ip, user_agent, request_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
