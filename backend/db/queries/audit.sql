-- Audit log reads (P1-05). Filters are optional: NULL / '' / empty array mean "any".
-- @q must already have LIKE wildcards escaped by the caller.

-- name: ListOrgAudit :many
SELECT a.id, a.created_at, a.action, a.object_type, a.object_id, a.before, a.after,
       a.ip, a.user_agent, a.request_id,
       a.actor_user_id, COALESCE(u.email::text, '')::text AS actor_email, COALESCE(u.display_name, '') AS actor_name
FROM audit_log a
LEFT JOIN users u ON u.id = a.actor_user_id
WHERE a.organization_id = @organization_id
  AND (sqlc.narg('actor_id')::uuid IS NULL OR a.actor_user_id = sqlc.narg('actor_id'))
  AND (sqlc.narg('from_time')::timestamptz IS NULL OR a.created_at >= sqlc.narg('from_time'))
  AND (sqlc.narg('to_time')::timestamptz IS NULL OR a.created_at < sqlc.narg('to_time'))
  AND (cardinality(@categories::text[]) = 0 OR split_part(a.action, '.', 1) = ANY (@categories::text[]))
  AND (@q::text = '' OR a.action ILIKE '%' || @q || '%' OR a.object_id ILIKE '%' || @q || '%'
       OR u.email::text ILIKE '%' || @q || '%')
ORDER BY a.created_at DESC, a.id DESC
LIMIT @lim OFFSET @off;

-- name: CountOrgAudit :one
SELECT count(*)
FROM audit_log a
LEFT JOIN users u ON u.id = a.actor_user_id
WHERE a.organization_id = @organization_id
  AND (sqlc.narg('actor_id')::uuid IS NULL OR a.actor_user_id = sqlc.narg('actor_id'))
  AND (sqlc.narg('from_time')::timestamptz IS NULL OR a.created_at >= sqlc.narg('from_time'))
  AND (sqlc.narg('to_time')::timestamptz IS NULL OR a.created_at < sqlc.narg('to_time'))
  AND (cardinality(@categories::text[]) = 0 OR split_part(a.action, '.', 1) = ANY (@categories::text[]))
  AND (@q::text = '' OR a.action ILIKE '%' || @q || '%' OR a.object_id ILIKE '%' || @q || '%'
       OR u.email::text ILIKE '%' || @q || '%');

-- name: ListSystemAudit :many
-- System-level events only (no organization): sign-ins, MFA, user administration (ADR-023).
SELECT a.id, a.created_at, a.action, a.object_type, a.object_id, a.before, a.after,
       a.ip, a.user_agent, a.request_id,
       a.actor_user_id, COALESCE(u.email::text, '')::text AS actor_email, COALESCE(u.display_name, '') AS actor_name
FROM audit_log a
LEFT JOIN users u ON u.id = a.actor_user_id
WHERE a.organization_id IS NULL
  AND (sqlc.narg('actor_id')::uuid IS NULL OR a.actor_user_id = sqlc.narg('actor_id'))
  AND (sqlc.narg('from_time')::timestamptz IS NULL OR a.created_at >= sqlc.narg('from_time'))
  AND (sqlc.narg('to_time')::timestamptz IS NULL OR a.created_at < sqlc.narg('to_time'))
  AND (cardinality(@categories::text[]) = 0 OR split_part(a.action, '.', 1) = ANY (@categories::text[]))
  AND (@q::text = '' OR a.action ILIKE '%' || @q || '%' OR a.object_id ILIKE '%' || @q || '%'
       OR u.email::text ILIKE '%' || @q || '%')
ORDER BY a.created_at DESC, a.id DESC
LIMIT @lim OFFSET @off;

-- name: CountSystemAudit :one
SELECT count(*)
FROM audit_log a
LEFT JOIN users u ON u.id = a.actor_user_id
WHERE a.organization_id IS NULL
  AND (sqlc.narg('actor_id')::uuid IS NULL OR a.actor_user_id = sqlc.narg('actor_id'))
  AND (sqlc.narg('from_time')::timestamptz IS NULL OR a.created_at >= sqlc.narg('from_time'))
  AND (sqlc.narg('to_time')::timestamptz IS NULL OR a.created_at < sqlc.narg('to_time'))
  AND (cardinality(@categories::text[]) = 0 OR split_part(a.action, '.', 1) = ANY (@categories::text[]))
  AND (@q::text = '' OR a.action ILIKE '%' || @q || '%' OR a.object_id ILIKE '%' || @q || '%'
       OR u.email::text ILIKE '%' || @q || '%');
