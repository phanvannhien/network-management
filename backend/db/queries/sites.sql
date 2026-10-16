-- Sites, locations, racks (P1-07, ADR-025). Every query takes organization_id; @scope (NULL = all sites)
-- applies the member's site_scope.

-- name: ListSites :many
-- @bu_filter: NULL = every site; @only_shared = organization-wide sites only.
SELECT s.*,
       COALESCE(b.code, '')::text AS business_unit_code, COALESCE(b.name, '')::text AS business_unit_name,
       (SELECT count(*) FROM locations l WHERE l.site_id = s.id)::bigint AS location_count,
       (SELECT count(*) FROM racks r WHERE r.site_id = s.id)::bigint AS rack_count
FROM sites s
LEFT JOIN business_units b ON b.id = s.business_unit_id
WHERE s.organization_id = @organization_id AND s.deleted_at IS NULL
  AND (sqlc.narg('scope')::uuid[] IS NULL OR s.id = ANY (sqlc.narg('scope')::uuid[]))
  AND (sqlc.narg('bu_filter')::uuid IS NULL OR s.business_unit_id = sqlc.narg('bu_filter'))
  AND (NOT @only_shared::boolean OR s.business_unit_id IS NULL)
ORDER BY s.code;

-- name: GetSite :one
SELECT s.*, COALESCE(b.code, '')::text AS business_unit_code, COALESCE(b.name, '')::text AS business_unit_name
FROM sites s
LEFT JOIN business_units b ON b.id = s.business_unit_id
WHERE s.id = @id AND s.organization_id = @organization_id AND s.deleted_at IS NULL
  AND (sqlc.narg('scope')::uuid[] IS NULL OR s.id = ANY (sqlc.narg('scope')::uuid[]));

-- name: CreateSite :one
INSERT INTO sites (organization_id, code, name, address, timezone, contact_name, contact_phone, contact_email, notes,
                   kind, business_unit_id, isp)
VALUES (@organization_id, @code, @name, @address, @timezone, @contact_name, @contact_phone, @contact_email, @notes,
        @kind, sqlc.narg('business_unit_id'), @isp)
RETURNING *;

-- name: UpdateSite :one
UPDATE sites SET code = @code, name = @name, address = @address, timezone = @timezone,
                 contact_name = @contact_name, contact_phone = @contact_phone, contact_email = @contact_email,
                 notes = @notes, kind = @kind, business_unit_id = sqlc.narg('business_unit_id'), isp = @isp,
                 version = version + 1
WHERE id = @id AND organization_id = @organization_id AND deleted_at IS NULL AND version = @version
RETURNING *;

-- name: SoftDeleteSite :one
UPDATE sites SET deleted_at = now(), version = version + 1
WHERE id = @id AND organization_id = @organization_id AND deleted_at IS NULL
RETURNING *;

-- name: CountLiveSitesIn :one
-- Validates a site_scope: how many of the ids are live sites of the organization.
SELECT count(*) FROM sites
WHERE organization_id = @organization_id AND deleted_at IS NULL AND id = ANY (@ids::uuid[]);

-- name: ListLocations :many
SELECT * FROM locations
WHERE organization_id = @organization_id AND site_id = @site_id
ORDER BY sort_order, lower(name);

-- name: GetLocation :one
SELECT * FROM locations WHERE id = @id AND organization_id = @organization_id AND site_id = @site_id;

-- name: CreateLocation :one
INSERT INTO locations (organization_id, site_id, parent_id, kind, name, sort_order)
VALUES (@organization_id, @site_id, sqlc.narg('parent_id'), @kind, @name, @sort_order)
RETURNING *;

-- name: UpdateLocation :one
UPDATE locations SET name = @name, sort_order = @sort_order, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND site_id = @site_id AND version = @version
RETURNING *;

-- name: CountLocationChildren :one
SELECT (SELECT count(*) FROM locations c WHERE c.parent_id = @id AND c.organization_id = @organization_id)::bigint AS children,
       (SELECT count(*) FROM racks r WHERE r.location_id = @id AND r.organization_id = @organization_id)::bigint AS racks;

-- name: DeleteLocation :execrows
DELETE FROM locations WHERE id = @id AND organization_id = @organization_id AND site_id = @site_id;

-- name: ListRacks :many
SELECT * FROM racks
WHERE organization_id = @organization_id AND site_id = @site_id
ORDER BY lower(name);

-- name: GetRack :one
SELECT * FROM racks WHERE id = @id AND organization_id = @organization_id AND site_id = @site_id;

-- name: CreateRack :one
INSERT INTO racks (organization_id, site_id, location_id, name, u_height, notes)
VALUES (@organization_id, @site_id, @location_id, @name, @u_height, @notes)
RETURNING *;

-- name: UpdateRack :one
UPDATE racks SET location_id = @location_id, name = @name, u_height = @u_height, notes = @notes, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND site_id = @site_id AND version = @version
RETURNING *;

-- name: DeleteRack :execrows
DELETE FROM racks WHERE id = @id AND organization_id = @organization_id AND site_id = @site_id;

-- name: ListSiteCodesWithPrefix :many
-- Live site codes starting with @prefix (ADR-030 next-code suggestion).
SELECT code::text FROM sites
WHERE organization_id = @organization_id AND deleted_at IS NULL AND code::text LIKE @prefix::text || '%';
