-- Organizations and memberships (P1-03, ADR-016, ADR-023).
-- Soft-deleted organizations (deleted_at IS NOT NULL) are invisible everywhere except audit history.

-- name: GetMembership :one
-- The tenant middleware's single source of truth: does this user belong to this (live) organization?
SELECT m.organization_id, m.user_id, m.role, m.permissions,
       o.name AS organization_name, o.kind AS organization_kind
FROM memberships m
JOIN organizations o ON o.id = m.organization_id
WHERE m.organization_id = $1 AND m.user_id = $2 AND o.deleted_at IS NULL;

-- name: ListMyOrganizations :many
SELECT o.id, o.name, o.kind, m.role
FROM memberships m
JOIN organizations o ON o.id = m.organization_id
WHERE m.user_id = $1 AND o.deleted_at IS NULL
ORDER BY lower(o.name), o.id;

-- name: GetOrganization :one
SELECT * FROM organizations WHERE id = $1 AND deleted_at IS NULL;

-- name: UpdateOrganization :one
-- Optimistic lock: succeeds only when the caller saw the latest version (else no row → 409).
UPDATE organizations
SET name = sqlc.arg(name), code = sqlc.arg(code), notes = sqlc.arg(notes), version = version + 1
WHERE id = sqlc.arg(id) AND version = sqlc.arg(version) AND deleted_at IS NULL
RETURNING *;

-- name: SetSessionActiveOrganization :exec
UPDATE sessions SET active_organization_id = $2 WHERE token_hash = $1;

-- System admin (not tenant-scoped by design: managing the list of organizations).

-- name: AdminListOrganizations :many
SELECT o.id, o.name, o.code, o.kind, o.notes, o.created_at, o.updated_at, o.version,
       (SELECT count(*) FROM memberships m WHERE m.organization_id = o.id) AS member_count,
       -- Counts only (no content): the system area shows each customer's size without reading its data (ADR-023).
       (SELECT count(*) FROM categories c WHERE c.organization_id = o.id)::bigint AS category_count,
       (SELECT count(*) FROM sites s WHERE s.organization_id = o.id AND s.deleted_at IS NULL)::bigint AS site_count
FROM organizations o
WHERE o.deleted_at IS NULL
ORDER BY lower(o.name), o.id;

-- name: CreateOrganization :one
INSERT INTO organizations (name, code, kind, notes) VALUES ($1, $2, $3, $4) RETURNING *;

-- name: AddMembership :one
INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3) RETURNING *;

-- name: SoftDeleteOrganization :one
UPDATE organizations SET deleted_at = now(), version = version + 1
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;
