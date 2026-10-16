-- Diagrams (P1-13, ADR-015/028). Every query takes organization_id; access follows the scope (organization role,
-- the business unit, or the site) and is computed by the API from the scope columns returned here.

-- name: ListDiagrams :many
SELECT dg.id, dg.organization_id, dg.scope, dg.business_unit_id, dg.site_id, dg.name, dg.layer, dg.description,
       dg.created_at, dg.updated_at, dg.version,
       COALESCE(u.code, su.code, '')::text AS unit_code, COALESCE(u.partner_id, su.partner_id) AS partner_id,
       COALESCE(p.code, sp.code, '')::text AS partner_code,
       COALESCE(s.code, '')::text AS site_code, COALESCE(s.name, '')::text AS site_name,
       s.business_unit_id AS site_unit_id, su.partner_id AS site_partner_id,
       COALESCE(jsonb_array_length(dg.view -> 'nodes'), 0)::int AS node_count
FROM diagrams dg
LEFT JOIN business_units u ON u.id = dg.business_unit_id AND u.deleted_at IS NULL
LEFT JOIN partners p ON p.id = u.partner_id
LEFT JOIN sites s ON s.id = dg.site_id AND s.deleted_at IS NULL
LEFT JOIN business_units su ON su.id = s.business_unit_id
LEFT JOIN partners sp ON sp.id = su.partner_id
WHERE dg.organization_id = @organization_id
  AND (dg.scope <> 'business_unit' OR u.id IS NOT NULL) AND (dg.scope <> 'site' OR s.id IS NOT NULL)
  AND (sqlc.narg('diagram_id')::uuid IS NULL OR dg.id = sqlc.narg('diagram_id'))
ORDER BY dg.scope, COALESCE(p.code, sp.code, ''), COALESCE(u.code, s.code, ''), lower(dg.name);

-- name: GetDiagramView :one
SELECT view FROM diagrams WHERE id = @id AND organization_id = @organization_id;

-- name: CreateDiagram :one
INSERT INTO diagrams (organization_id, scope, business_unit_id, site_id, name, layer, description, created_by)
VALUES (@organization_id, @scope, sqlc.narg('business_unit_id'), sqlc.narg('site_id'), @name, @layer, @description,
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
