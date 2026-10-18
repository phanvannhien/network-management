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
-- Counts a failure and locks the account once it reaches the threshold. While locked nothing is counted (no row back),
-- so nobody can keep an account locked forever; once a lock has expired the count starts over.
UPDATE users
SET failed_login_count = CASE WHEN locked_until IS NOT NULL THEN 1 ELSE failed_login_count + 1 END,
    locked_until = CASE
      WHEN (CASE WHEN locked_until IS NOT NULL THEN 1 ELSE failed_login_count + 1 END) >= sqlc.arg(max_failures)::int
        THEN now() + make_interval(secs => sqlc.arg(lock_seconds)::int)
      ELSE NULL
    END
WHERE id = sqlc.arg(id) AND (locked_until IS NULL OR locked_until <= now())
RETURNING failed_login_count, locked_until;

-- name: ResetLoginFailures :exec
UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1;

-- name: CreateSession :exec
INSERT INTO sessions (token_hash, user_id, csrf_token, ip, user_agent, expires_at)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: GetSession :one
-- Returns the live session joined with its (enabled) user and MFA state.
SELECT s.token_hash, s.csrf_token, s.created_at, s.last_seen_at, s.expires_at, s.mfa_verified_at,
       s.active_organization_id,
       u.id AS user_id, u.email, u.display_name, u.is_system_admin,
       (t.enabled_at IS NOT NULL)::boolean AS mfa_enabled,
       (u.is_system_admin OR EXISTS (
          SELECT 1 FROM memberships m WHERE m.user_id = u.id
            AND (m.role IN ('owner', 'admin') OR m.permissions && ARRAY['credential.reveal', 'credential.manage', 'user.manage']::text[])
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
