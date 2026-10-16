-- Sites, locations, racks (P1-07, ADR-025/032). Every query takes organization_id. A site belongs to one category or
-- straight to the organization; `code` is its full code derived from the category path, `local_code` its own part.

-- name: ListSites :many
-- @category_filter: the category and everything below it; @only_root: sites attached straight to the organization.
SELECT s.*, category_path(s.category_id)::text AS category_path,
       (SELECT count(*) FROM locations l WHERE l.site_id = s.id)::bigint AS location_count,
       (SELECT count(*) FROM racks r WHERE r.site_id = s.id)::bigint AS rack_count
FROM sites s
WHERE s.organization_id = @organization_id AND s.deleted_at IS NULL
  AND (sqlc.narg('id_filter')::uuid IS NULL OR s.id = sqlc.narg('id_filter'))
  AND (sqlc.narg('category_filter')::uuid IS NULL
       OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
  AND (NOT @only_root::boolean OR s.category_id IS NULL)
ORDER BY s.code;

-- name: GetSite :one
SELECT s.*, category_path(s.category_id)::text AS category_path
FROM sites s
WHERE s.id = @id AND s.organization_id = @organization_id AND s.deleted_at IS NULL;

-- name: CreateSite :one
INSERT INTO sites (organization_id, code, local_code, name, address, timezone, contact_name, contact_phone, contact_email,
                   notes, kind, category_id, isp)
VALUES (@organization_id, @code, @local_code, @name, @address, @timezone, @contact_name, @contact_phone, @contact_email,
        @notes, @kind, sqlc.narg('category_id'), @isp)
RETURNING *;

-- name: UpdateSite :one
UPDATE sites SET code = @code, local_code = @local_code, name = @name, address = @address, timezone = @timezone,
                 contact_name = @contact_name, contact_phone = @contact_phone, contact_email = @contact_email,
                 notes = @notes, kind = @kind, category_id = sqlc.narg('category_id'), isp = @isp,
                 version = version + 1
WHERE id = @id AND organization_id = @organization_id AND deleted_at IS NULL AND version = @version
RETURNING *;

-- name: SoftDeleteSite :one
UPDATE sites SET deleted_at = now(), version = version + 1
WHERE id = @id AND organization_id = @organization_id AND deleted_at IS NULL
RETURNING *;

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
