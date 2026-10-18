-- Category tree (P1-27, ADR-032). Every query takes organization_id.

-- name: ListCategories :many
SELECT c.*,
       (SELECT count(*) FROM categories k WHERE k.parent_id = c.id)::bigint AS child_count,
       (SELECT count(*) FROM sites s WHERE s.category_id = c.id AND s.deleted_at IS NULL)::bigint AS site_count
FROM categories c
WHERE c.organization_id = @organization_id
ORDER BY lower(c.name);

-- name: GetCategory :one
SELECT * FROM categories WHERE id = @id AND organization_id = @organization_id;

-- name: CreateCategory :one
INSERT INTO categories (organization_id, parent_id, code, name, contact_name, contact_phone, contact_email, notes)
VALUES (@organization_id, sqlc.narg('parent_id'), @code, @name, @contact_name, @contact_phone, @contact_email, @notes)
RETURNING *;

-- name: UpdateCategory :execrows
UPDATE categories SET parent_id = sqlc.narg('parent_id'), code = @code, name = @name, contact_name = @contact_name,
  contact_phone = @contact_phone, contact_email = @contact_email, notes = @notes, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND version = @version;

-- name: DeleteCategory :execrows
DELETE FROM categories WHERE id = @id AND organization_id = @organization_id;

-- name: ListSiteCodes :many
-- Live sites with what their full code is made of, for re-coding after a tree change.
SELECT id, category_id, local_code, code::text AS code, name FROM sites
WHERE organization_id = @organization_id AND deleted_at IS NULL
ORDER BY code;

-- name: SetSiteCode :exec
UPDATE sites SET code = @code, version = version + 1 WHERE id = @id AND organization_id = @organization_id;
