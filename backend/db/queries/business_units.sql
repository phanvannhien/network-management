-- Business units (P1-07, ADR-026). Every query takes organization_id.

-- name: ListBusinessUnits :many
SELECT b.*,
       (SELECT count(*) FROM sites s WHERE s.business_unit_id = b.id AND s.deleted_at IS NULL)::bigint AS site_count
FROM business_units b
WHERE b.organization_id = @organization_id AND b.deleted_at IS NULL
ORDER BY b.code;

-- name: GetBusinessUnit :one
SELECT b.*,
       (SELECT count(*) FROM sites s WHERE s.business_unit_id = b.id AND s.deleted_at IS NULL)::bigint AS site_count
FROM business_units b
WHERE b.id = @id AND b.organization_id = @organization_id AND b.deleted_at IS NULL;

-- name: CreateBusinessUnit :one
INSERT INTO business_units (organization_id, code, name, relation, contact_name, contact_phone, contact_email, notes)
VALUES (@organization_id, @code, @name, @relation, @contact_name, @contact_phone, @contact_email, @notes)
RETURNING *;

-- name: UpdateBusinessUnit :one
UPDATE business_units SET code = @code, name = @name, relation = @relation, contact_name = @contact_name,
       contact_phone = @contact_phone, contact_email = @contact_email, notes = @notes, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND deleted_at IS NULL AND version = @version
RETURNING *;

-- name: RenameUnitSitePrefix :execrows
-- ADR-030: site codes carry the unit code; renaming the unit renames the prefix of its live sites.
UPDATE sites
SET code = @new_code::text || substr(code::text, length(@old_code::text) + 1), version = version + 1
WHERE organization_id = @organization_id AND business_unit_id = @id AND deleted_at IS NULL
  AND code::text LIKE @old_code::text || '-%';

-- name: SoftDeleteBusinessUnit :one
UPDATE business_units SET deleted_at = now(), version = version + 1
WHERE id = @id AND organization_id = @organization_id AND deleted_at IS NULL
RETURNING *;
