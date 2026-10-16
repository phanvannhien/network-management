-- MFA data is per user (global, not tenant-scoped).

-- name: GetTOTP :one
SELECT * FROM mfa_totp WHERE user_id = $1;

-- name: UpsertPendingTOTP :execrows
-- Starts (or restarts) enrollment. Never overwrites an enabled seed: the caller must disable first.
INSERT INTO mfa_totp (user_id, secret_ciphertext, wrapped_dek, key_version)
VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id) DO UPDATE
SET secret_ciphertext = EXCLUDED.secret_ciphertext,
    wrapped_dek       = EXCLUDED.wrapped_dek,
    key_version       = EXCLUDED.key_version,
    last_used_step    = 0
WHERE mfa_totp.enabled_at IS NULL;

-- name: EnableTOTP :execrows
UPDATE mfa_totp SET enabled_at = now(), last_used_step = sqlc.arg(step)
WHERE user_id = sqlc.arg(user_id) AND enabled_at IS NULL;

-- name: ClaimTOTPStep :execrows
-- Atomically accepts a time step only if it is newer than the last one used (blocks code replay).
UPDATE mfa_totp SET last_used_step = sqlc.arg(step)
WHERE user_id = sqlc.arg(user_id) AND enabled_at IS NOT NULL AND last_used_step < sqlc.arg(step);

-- name: DeleteTOTP :exec
DELETE FROM mfa_totp WHERE user_id = $1;

-- name: InsertRecoveryCode :exec
INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2);

-- name: DeleteRecoveryCodes :exec
DELETE FROM mfa_recovery_codes WHERE user_id = $1;

-- name: UseRecoveryCode :execrows
UPDATE mfa_recovery_codes SET used_at = now()
WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL;

-- name: CountUnusedRecoveryCodes :one
SELECT count(*) FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL;

-- name: MarkSessionMFAVerified :exec
UPDATE sessions SET mfa_verified_at = now() WHERE token_hash = $1;

-- name: UserRequiresMFA :one
-- ADR-019 / SRS §10: system admins and organization owners/admins must use MFA.
SELECT (u.is_system_admin OR EXISTS (
          SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.role IN ('owner', 'admin')
        ))::boolean AS required
FROM users u WHERE u.id = $1;
