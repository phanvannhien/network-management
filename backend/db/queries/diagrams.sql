-- Diagrams (P1-13, ADR-015/032). Every query takes organization_id; diagrams belong to the organization.

-- name: ListDiagrams :many
SELECT dg.id, dg.organization_id, dg.name, dg.layer, dg.description, dg.created_at, dg.updated_at, dg.version,
       COALESCE(jsonb_array_length(dg.view -> 'nodes'), 0)::int AS node_count
FROM diagrams dg
WHERE dg.organization_id = @organization_id
  AND (sqlc.narg('diagram_id')::uuid IS NULL OR dg.id = sqlc.narg('diagram_id'))
ORDER BY lower(dg.name);

-- name: GetDiagramView :one
SELECT view FROM diagrams WHERE id = @id AND organization_id = @organization_id;

-- name: CreateDiagram :one
INSERT INTO diagrams (organization_id, name, layer, description, created_by)
VALUES (@organization_id, @name, @layer, @description,
        sqlc.narg('created_by'))
RETURNING id;

-- name: UpdateDiagramMeta :execrows
UPDATE diagrams SET name = @name, layer = @layer, description = @description, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND version = @version;

-- name: SaveDiagramView :one
UPDATE diagrams SET view = @view, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND version = @version
RETURNING version;

-- name: DeleteDiagram :execrows
DELETE FROM diagrams WHERE id = @id AND organization_id = @organization_id;

-- name: ListDiagramsShowing :many
-- Diagrams whose view places any of the given objects, with the ones it places.
SELECT dg.id, dg.name, array_agg(DISTINCT n.ref_id ORDER BY n.ref_id)::text[] AS ref_ids
FROM diagrams dg
CROSS JOIN LATERAL (SELECT e ->> 'refId' AS ref_id FROM jsonb_array_elements(COALESCE(dg.view -> 'nodes', '[]')) e) n
WHERE dg.organization_id = @organization_id AND n.ref_id = ANY (@ids::text[])
GROUP BY dg.id, dg.name
ORDER BY lower(dg.name);
