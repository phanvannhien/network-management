-- Partners (P1-07b, ADR-031): the organization's subsidiaries / partners / customers. Every query takes organization_id.

-- name: ListPartners :many
SELECT p.*,
       (SELECT count(*) FROM business_units u WHERE u.partner_id = p.id AND u.deleted_at IS NULL)::bigint AS unit_count,
       (SELECT count(*) FROM sites s JOIN business_units u ON u.id = s.business_unit_id
         WHERE u.partner_id = p.id AND s.deleted_at IS NULL)::bigint AS site_count
FROM partners p
WHERE p.organization_id = @organization_id AND p.deleted_at IS NULL
ORDER BY p.code;

-- name: GetPartner :one
SELECT p.*,
       (SELECT count(*) FROM business_units u WHERE u.partner_id = p.id AND u.deleted_at IS NULL)::bigint AS unit_count,
       (SELECT count(*) FROM sites s JOIN business_units u ON u.id = s.business_unit_id
         WHERE u.partner_id = p.id AND s.deleted_at IS NULL)::bigint AS site_count
FROM partners p
WHERE p.id = @id AND p.organization_id = @organization_id AND p.deleted_at IS NULL;

-- name: CreatePartner :one
INSERT INTO partners (organization_id, code, name, relation, contact_name, contact_phone, contact_email, notes)
VALUES (@organization_id, @code, @name, @relation, @contact_name, @contact_phone, @contact_email, @notes)
RETURNING *;

-- name: UpdatePartner :one
UPDATE partners SET code = @code, name = @name, relation = @relation, contact_name = @contact_name,
       contact_phone = @contact_phone, contact_email = @contact_email, notes = @notes, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND deleted_at IS NULL AND version = @version
RETURNING *;

-- name: RenamePartnerSitePrefix :execrows
-- ADR-030/031: site codes carry the partner code; renaming the partner renames the prefix of its live sites.
UPDATE sites s
SET code = @new_code::text || substr(s.code::text, length(@old_code::text) + 1), version = s.version + 1
FROM business_units u
WHERE u.id = s.business_unit_id AND u.partner_id = @id AND s.organization_id = @organization_id
  AND s.deleted_at IS NULL AND s.code::text LIKE @old_code::text || '-%';

-- name: SoftDeletePartner :one
UPDATE partners SET deleted_at = now(), version = version + 1
WHERE id = @id AND organization_id = @organization_id AND deleted_at IS NULL
RETURNING *;
