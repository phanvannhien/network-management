-- Organization members (P1-04). Every query is scoped by organization_id.

-- name: ListMembers :many
SELECT u.id AS user_id, u.email, u.display_name, m.role, m.permissions, m.version,
       (t.enabled_at IS NOT NULL)::boolean AS mfa_enabled,
       (u.disabled_at IS NOT NULL)::boolean AS disabled,
       (u.password_hash = '')::boolean AS pending_invite
FROM memberships m
JOIN users u ON u.id = m.user_id
LEFT JOIN mfa_totp t ON t.user_id = u.id
WHERE m.organization_id = $1
ORDER BY lower(u.display_name), lower(u.email::text);

-- name: GetMember :one
SELECT u.id AS user_id, u.email, u.display_name, m.role, m.permissions, m.version,
       (t.enabled_at IS NOT NULL)::boolean AS mfa_enabled,
       (u.disabled_at IS NOT NULL)::boolean AS disabled,
       (u.password_hash = '')::boolean AS pending_invite
FROM memberships m
JOIN users u ON u.id = m.user_id
LEFT JOIN mfa_totp t ON t.user_id = u.id
WHERE m.organization_id = $1 AND m.user_id = $2;

-- name: CountOtherActiveOwners :one
-- Owners left besides @user_id whose account is active (signed up, not disabled). Every owner row is locked, in one
-- order, so two owners demoting each other at the same time wait for each other instead of leaving the organization
-- without one (or deadlocking).
SELECT count(*) FILTER (WHERE owners.user_id <> @user_id::uuid AND owners.active)::bigint AS count FROM (
  SELECT m.user_id, (u.disabled_at IS NULL AND u.password_hash <> '') AS active
  FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.organization_id = @organization_id::uuid AND m.role = 'owner'
  ORDER BY m.user_id
  FOR UPDATE OF m
) AS owners;

-- name: UpdateMembership :one
UPDATE memberships
SET role = sqlc.arg(role), permissions = sqlc.arg(permissions), version = version + 1
WHERE organization_id = sqlc.arg(organization_id) AND user_id = sqlc.arg(user_id) AND version = sqlc.arg(version)
RETURNING *;

-- name: AddMembershipWithPermissions :one
INSERT INTO memberships (organization_id, user_id, role, permissions)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: DeleteMembership :execrows
DELETE FROM memberships WHERE organization_id = $1 AND user_id = $2;

-- name: CreateInvitedUser :one
INSERT INTO users (email, display_name, password_hash) VALUES ($1, '', '') RETURNING *;

-- Account tokens (invite / password reset).

-- name: CreateUserToken :exec
INSERT INTO user_tokens (token_hash, user_id, purpose, created_by, expires_at) VALUES ($1, $2, $3, $4, $5);

-- name: InvalidateUserTokens :exec
-- Only the newest link is valid: issuing a new one (or using one) retires the others of that purpose.
UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL;

-- name: GetUserToken :one
SELECT t.token_hash, t.user_id, t.purpose, u.email
FROM user_tokens t
JOIN users u ON u.id = t.user_id
WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.disabled_at IS NULL;

-- name: UseUserToken :execrows
UPDATE user_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now();

-- name: SetUserPassword :exec
UPDATE users
SET password_hash = $2, display_name = CASE WHEN sqlc.arg(display_name)::text <> '' THEN sqlc.arg(display_name)::text ELSE display_name END,
    failed_login_count = 0, locked_until = NULL, version = version + 1
WHERE id = $1;

-- name: ListUserOrganizationNames :many
SELECT o.name FROM memberships m JOIN organizations o ON o.id = m.organization_id
WHERE m.user_id = $1 AND o.deleted_at IS NULL ORDER BY lower(o.name);

-- name: DeleteUserSessions :exec
DELETE FROM sessions WHERE user_id = $1;

-- System admin: user management (global by design).

-- name: AdminListUsers :many
SELECT u.id, u.email, u.display_name, u.is_system_admin, u.created_at,
       (t.enabled_at IS NOT NULL)::boolean AS mfa_enabled,
       (u.disabled_at IS NOT NULL)::boolean AS disabled,
       (u.password_hash = '')::boolean AS pending_invite,
       (SELECT count(*) FROM memberships m JOIN organizations o ON o.id = m.organization_id
         WHERE m.user_id = u.id AND o.deleted_at IS NULL) AS organization_count
FROM users u
LEFT JOIN mfa_totp t ON t.user_id = u.id
ORDER BY lower(u.email::text);

-- name: SetUserDisabled :one
UPDATE users SET disabled_at = CASE WHEN sqlc.arg(disabled)::boolean THEN now() ELSE NULL END, version = version + 1
WHERE id = sqlc.arg(id)
RETURNING id, email, is_system_admin;

-- name: CountActiveSystemAdmins :one
SELECT count(*) FROM users WHERE is_system_admin AND disabled_at IS NULL;

-- name: ResetUserMFA :exec
DELETE FROM mfa_totp WHERE user_id = $1;

-- name: CountUserMemberships :one
SELECT count(*) FROM memberships WHERE user_id = $1;
