-- Business units (P1-07b, ADR-031): always under one partner. Every query takes organization_id.

-- name: ListBusinessUnits :many
SELECT u.*, p.code::text AS partner_code, p.name AS partner_name,
       (SELECT count(*) FROM sites s WHERE s.business_unit_id = u.id AND s.deleted_at IS NULL)::bigint AS site_count
FROM business_units u
JOIN partners p ON p.id = u.partner_id
WHERE u.organization_id = @organization_id AND u.deleted_at IS NULL
  AND (sqlc.narg('partner_filter')::uuid IS NULL OR u.partner_id = sqlc.narg('partner_filter'))
ORDER BY p.code, u.code;

-- name: GetBusinessUnit :one
SELECT u.*, p.code::text AS partner_code, p.name AS partner_name,
       (SELECT count(*) FROM sites s WHERE s.business_unit_id = u.id AND s.deleted_at IS NULL)::bigint AS site_count
FROM business_units u
JOIN partners p ON p.id = u.partner_id
WHERE u.id = @id AND u.organization_id = @organization_id AND u.deleted_at IS NULL;

-- name: CreateBusinessUnit :one
INSERT INTO business_units (organization_id, partner_id, code, name, contact_name, contact_phone, contact_email, notes)
VALUES (@organization_id, @partner_id, @code, @name, @contact_name, @contact_phone, @contact_email, @notes)
RETURNING *;

-- name: UpdateBusinessUnit :one
UPDATE business_units SET code = @code, name = @name, contact_name = @contact_name, contact_phone = @contact_phone,
       contact_email = @contact_email, notes = @notes, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND deleted_at IS NULL AND version = @version
RETURNING *;

-- name: SoftDeleteBusinessUnit :one
UPDATE business_units SET deleted_at = now(), version = version + 1
WHERE id = @id AND organization_id = @organization_id AND deleted_at IS NULL
RETURNING *;
