-- Links (P1-12, SRS §6.2). Every query takes organization_id. Each row carries both ends' names, ownership and
-- interface so the API can check visibility per end (an end is visible like its device / group, ADR-031).

-- name: ListLinks :many
SELECT l.*,
  COALESCE(ad.hostname, ag.name, '')::text AS a_name, COALESCE(ad.type, ag.kind, '')::text AS a_type,
  COALESCE(ad.site_id, ag.site_id) AS a_site_id, COALESCE(ad.business_unit_id, ag.business_unit_id) AS a_unit_id,
  au.partner_id AS a_partner_id, asite.business_unit_id AS a_site_unit_id, asb.partner_id AS a_site_partner_id,
  COALESCE(asite.code, '')::text AS a_site_code,
  COALESCE(ai.name, '')::text AS a_interface_name, COALESCE(ai.kind, '')::text AS a_interface_kind,
  COALESCE(ai.media, '')::text AS a_interface_media,
  COALESCE(bd.hostname, bg.name, '')::text AS b_name, COALESCE(bd.type, bg.kind, '')::text AS b_type,
  COALESCE(bd.site_id, bg.site_id) AS b_site_id, COALESCE(bd.business_unit_id, bg.business_unit_id) AS b_unit_id,
  bu.partner_id AS b_partner_id, bsite.business_unit_id AS b_site_unit_id, bsb.partner_id AS b_site_partner_id,
  COALESCE(bsite.code, '')::text AS b_site_code,
  COALESCE(bi.name, '')::text AS b_interface_name, COALESCE(bi.kind, '')::text AS b_interface_kind,
  COALESCE(bi.media, '')::text AS b_interface_media
FROM links l
LEFT JOIN devices ad ON l.a_kind = 'device' AND ad.id = l.a_id AND ad.deleted_at IS NULL
LEFT JOIN endpoint_groups ag ON l.a_kind = 'endpoint_group' AND ag.id = l.a_id
LEFT JOIN business_units au ON au.id = COALESCE(ad.business_unit_id, ag.business_unit_id)
LEFT JOIN sites asite ON asite.id = COALESCE(ad.site_id, ag.site_id) AND asite.deleted_at IS NULL
LEFT JOIN business_units asb ON asb.id = asite.business_unit_id
LEFT JOIN interfaces ai ON ai.id = l.a_interface_id
LEFT JOIN devices bd ON l.b_kind = 'device' AND bd.id = l.b_id AND bd.deleted_at IS NULL
LEFT JOIN endpoint_groups bg ON l.b_kind = 'endpoint_group' AND bg.id = l.b_id
LEFT JOIN business_units bu ON bu.id = COALESCE(bd.business_unit_id, bg.business_unit_id)
LEFT JOIN sites bsite ON bsite.id = COALESCE(bd.site_id, bg.site_id) AND bsite.deleted_at IS NULL
LEFT JOIN business_units bsb ON bsb.id = bsite.business_unit_id
LEFT JOIN interfaces bi ON bi.id = l.b_interface_id
WHERE l.organization_id = @organization_id
  AND (sqlc.narg('link_id')::uuid IS NULL OR l.id = sqlc.narg('link_id'))
  AND (sqlc.narg('link_ids')::uuid[] IS NULL OR l.id = ANY (sqlc.narg('link_ids')::uuid[]))
  AND (sqlc.narg('end_id')::uuid IS NULL OR l.a_id = sqlc.narg('end_id') OR l.b_id = sqlc.narg('end_id'))
  AND (sqlc.narg('site_id')::uuid IS NULL OR COALESCE(ad.site_id, ag.site_id) = sqlc.narg('site_id')
       OR COALESCE(bd.site_id, bg.site_id) = sqlc.narg('site_id'))
ORDER BY COALESCE(ad.hostname, ag.name), COALESCE(ai.name, ''), l.created_at;

-- name: LockInterfaceLinks :exec
-- Serializes link writes touching one interface (one physical link per physical port).
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(lock_key)::text, 0));

-- name: CountPhysicalLinksOnInterface :one
SELECT count(*) FROM links
WHERE organization_id = @organization_id AND kind <> 'logical' AND id IS DISTINCT FROM sqlc.narg('self_id')::uuid
  AND (a_interface_id = @interface_id OR b_interface_id = @interface_id);

-- name: GetLinkEndInterface :one
SELECT i.id, i.name, i.kind, i.device_id FROM interfaces i
WHERE i.id = @id AND i.organization_id = @organization_id;

-- name: CreateLink :one
INSERT INTO links (organization_id, a_kind, a_id, a_interface_id, b_kind, b_id, b_interface_id, kind, medium, speed,
                   length_m, cable_id, status, provider, circuit_id, bandwidth, notes)
VALUES (@organization_id, @a_kind, @a_id, sqlc.narg('a_interface_id'), @b_kind, @b_id, sqlc.narg('b_interface_id'), @kind,
        @medium, @speed, sqlc.narg('length_m'), @cable_id, @status, @provider, @circuit_id, @bandwidth, @notes)
RETURNING id;

-- name: UpdateLink :execrows
UPDATE links SET a_kind = @a_kind, a_id = @a_id, a_interface_id = sqlc.narg('a_interface_id'), b_kind = @b_kind,
  b_id = @b_id, b_interface_id = sqlc.narg('b_interface_id'), kind = @kind, medium = @medium, speed = @speed,
  length_m = sqlc.narg('length_m'), cable_id = @cable_id, status = @status, provider = @provider,
  circuit_id = @circuit_id, bandwidth = @bandwidth, notes = @notes, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND version = @version;

-- name: DeleteLink :execrows
DELETE FROM links WHERE id = @id AND organization_id = @organization_id;

-- name: DeleteLinksOfEnd :many
-- A deleted device / endpoint group takes its links along.
DELETE FROM links WHERE organization_id = @organization_id
  AND ((a_kind = @end_kind AND a_id = @end_id) OR (b_kind = @end_kind AND b_id = @end_id))
RETURNING id;

-- name: ListLinkIDsAmong :many
-- Links whose both ends are among the given objects (the nodes of a diagram).
SELECT id FROM links
WHERE organization_id = @organization_id AND a_id = ANY (@ids::uuid[]) AND b_id = ANY (@ids::uuid[]);

-- name: LinkExists :one
SELECT EXISTS (SELECT 1 FROM links WHERE id = @id AND organization_id = @organization_id)::boolean;
