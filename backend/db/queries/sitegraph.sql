-- Site graph (P2-21, ADR-040): what an overview diagram shows of each site and between sites, derived live from the
-- inventory. Every query takes organization_id and the category filter (NULL = whole organization, else its subtree).

-- name: SiteGraphSites :many
SELECT s.id, s.code::text AS code, s.local_code, s.name, s.kind, s.category_id,
       COALESCE(category_path(s.category_id), '')::text AS category_path,
       count(d.id) FILTER (WHERE d.lifecycle <> 'retired' AND d.type <> 'provider_cloud')::bigint AS devices,
       count(d.id) FILTER (WHERE d.lifecycle = 'planned' AND d.type <> 'provider_cloud')::bigint AS planned,
       (SELECT count(*) FROM endpoint_groups g WHERE g.site_id = s.id AND g.organization_id = s.organization_id)::bigint AS groups
FROM sites s
LEFT JOIN devices d ON d.site_id = s.id AND d.organization_id = s.organization_id AND d.deleted_at IS NULL
WHERE s.organization_id = @organization_id AND s.deleted_at IS NULL
  AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
GROUP BY s.id
ORDER BY s.code;

-- name: SiteGraphGateways :many
-- Firewalls / routers / VPN gateways of each site (the "edge" of the site), with their cluster.
SELECT d.site_id, d.type, d.model, d.cluster_id, COALESCE(c.kind, '')::text AS cluster_kind
FROM devices d
LEFT JOIN device_clusters c ON c.id = d.cluster_id AND c.organization_id = d.organization_id
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL AND d.lifecycle <> 'retired'
  AND d.type IN ('firewall', 'router', 'vpn_gateway', 'sdwan_edge')
ORDER BY d.site_id, d.type, d.model;

-- name: SiteGraphLinks :many
-- Links between two devices (no provider cloud) with the site of each end; the API keeps those across sites.
SELECT l.id, l.kind, l.service, l.medium, l.bandwidth, l.provider, da.site_id AS site_a, db.site_id AS site_b
FROM links l
JOIN devices da ON da.id = l.a_id AND da.organization_id = l.organization_id AND da.deleted_at IS NULL AND da.type <> 'provider_cloud'
JOIN devices db ON db.id = l.b_id AND db.organization_id = l.organization_id AND db.deleted_at IS NULL AND db.type <> 'provider_cloud'
WHERE l.organization_id = @organization_id AND l.a_kind = 'device' AND l.b_kind = 'device' AND da.site_id <> db.site_id;

-- name: SiteGraphWan :many
-- The site's lines to an ISP: links between a device of the site and a provider cloud.
SELECT dev.site_id, l.service, l.provider, l.bandwidth, l.medium, cloud.hostname AS cloud
FROM links l
JOIN devices dev ON dev.organization_id = l.organization_id AND dev.deleted_at IS NULL AND dev.type <> 'provider_cloud'
  AND dev.id IN (l.a_id, l.b_id)
JOIN devices cloud ON cloud.organization_id = l.organization_id AND cloud.deleted_at IS NULL AND cloud.type = 'provider_cloud'
  AND cloud.id IN (l.a_id, l.b_id)
WHERE l.organization_id = @organization_id AND l.a_kind = 'device' AND l.b_kind = 'device'
ORDER BY dev.site_id, l.service, l.provider;

-- name: SiteGraphDiagrams :many
-- Detail diagrams of each site: diagrams (not overviews) that place at least one device of the site.
SELECT d.site_id, dg.id, dg.name, dg.layer, count(*)::bigint AS placed
FROM diagrams dg
CROSS JOIN LATERAL (SELECT e ->> 'refId' AS ref_id FROM jsonb_array_elements(COALESCE(dg.view -> 'nodes', '[]')) e
                    WHERE e ->> 'refKind' = 'device' AND e ->> 'refId' ~ '^[0-9a-f-]{36}$') n
JOIN devices d ON d.id = n.ref_id::uuid AND d.organization_id = dg.organization_id AND d.deleted_at IS NULL
WHERE dg.organization_id = @organization_id AND dg.layer <> 'overview'
GROUP BY d.site_id, dg.id, dg.name, dg.layer
ORDER BY d.site_id, count(*) DESC, lower(dg.name);
