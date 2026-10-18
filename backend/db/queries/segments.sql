-- Segments (P2-08, ADR-047): shared networks cables end in. Every query is scoped to @organization_id.

-- name: ListSegments :many
SELECT sg.*, COALESCE(v.name, '')::text AS vendor_name,
       (SELECT count(*) FROM links l WHERE l.organization_id = sg.organization_id
          AND ((l.a_kind = 'segment' AND l.a_id = sg.id) OR (l.b_kind = 'segment' AND l.b_id = sg.id)))::bigint AS link_count
FROM segments sg
LEFT JOIN vendors v ON v.id = sg.vendor_id AND v.organization_id = sg.organization_id AND v.deleted_at IS NULL
WHERE sg.organization_id = @organization_id
  AND (sqlc.narg('ids')::uuid[] IS NULL OR sg.id = ANY (sqlc.narg('ids')::uuid[]))
ORDER BY lower(sg.name);

-- name: GetSegment :one
SELECT * FROM segments WHERE organization_id = @organization_id AND id = @id;

-- name: CreateSegment :one
INSERT INTO segments (organization_id, name, kind, vendor_id, service_id, notes)
VALUES (@organization_id, @name, @kind, sqlc.narg('vendor_id'), @service_id, @notes)
RETURNING *;

-- name: UpdateSegment :one
UPDATE segments SET name = @name, kind = @kind, vendor_id = sqlc.narg('vendor_id'), service_id = @service_id, notes = @notes,
  version = version + 1
WHERE organization_id = @organization_id AND id = @id AND version = @version
RETURNING *;

-- name: DeleteSegment :execrows
DELETE FROM segments WHERE organization_id = @organization_id AND id = @id;

-- name: SegmentLinkCount :one
SELECT count(*) FROM links
WHERE organization_id = @organization_id AND ((a_kind = 'segment' AND a_id = @id) OR (b_kind = 'segment' AND b_id = @id));

-- name: SegmentNameTaken :one
SELECT EXISTS (SELECT 1 FROM segments WHERE organization_id = @organization_id AND lower(name) = lower(@name)
  AND id IS DISTINCT FROM sqlc.narg('self')::uuid)::boolean;
