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

-- name: DiagramVlans :many
-- L2 view (P2-08): VLANs of the given sites and the organization-wide ones (name and colour per VLAN id).
SELECT v.vid, v.name, v.color, v.site_id
FROM vlans v
WHERE v.organization_id = @organization_id AND (v.site_id IS NULL OR v.site_id = ANY (@site_ids::uuid[]))
ORDER BY v.vid, v.site_id NULLS LAST;

-- name: DiagramGateways :many
-- L2 view: IPs of the given devices that are the gateway of a subnet (same VRF) with a VLAN — where the VLAN is routed.
SELECT ip.device_id, v.vid, v.site_id, host(ip.address)::text AS address, COALESCE(i.name, '')::text AS interface_name
FROM ip_addresses ip
JOIN subnets s ON s.organization_id = ip.organization_id AND s.gateway IS NOT NULL AND s.vrf = ip.vrf
  AND host(s.gateway)::inet = host(ip.address)::inet
JOIN vlans v ON v.id = s.vlan_id AND v.organization_id = ip.organization_id
LEFT JOIN interfaces i ON i.id = ip.interface_id AND i.organization_id = ip.organization_id
WHERE ip.organization_id = @organization_id AND ip.device_id = ANY (@device_ids::uuid[])
ORDER BY v.vid;

-- name: DiagramL3Attachments :many
-- L3 pages (P2-08): configured IPs of the given devices with the most specific subnet (same VRF) each falls in.
SELECT ip.device_id, COALESCE(i.name, '')::text AS interface_name, COALESCE(i.kind, '')::text AS interface_kind,
       ip.address::text AS address, s.id AS subnet_id,
       COALESCE(s.gateway IS NOT NULL AND host(s.gateway)::inet = host(ip.address)::inet, false)::boolean AS is_gateway
FROM ip_addresses ip
LEFT JOIN interfaces i ON i.id = ip.interface_id AND i.organization_id = ip.organization_id
LEFT JOIN LATERAL (
  SELECT sn.id, sn.gateway FROM subnets sn
  WHERE sn.organization_id = ip.organization_id AND sn.vrf = ip.vrf AND host(ip.address)::inet <<= sn.cidr
  ORDER BY masklen(sn.cidr) DESC LIMIT 1
) s ON true
WHERE ip.organization_id = @organization_id AND ip.device_id = ANY (@device_ids::uuid[])
  AND ip.role IN ('primary', 'secondary') AND ip.interface_id IS NOT NULL
ORDER BY ip.device_id, ip.address;

-- name: DiagramL3Groups :many
-- The subnet of each given endpoint group's IP range.
SELECT g.id AS group_id, r.subnet_id
FROM endpoint_groups g
JOIN ip_ranges r ON r.id = g.ip_range_id AND r.organization_id = g.organization_id
WHERE g.organization_id = @organization_id AND g.id = ANY (@group_ids::uuid[]);

-- name: DiagramSubnets :many
SELECT s.id, s.cidr::text AS cidr, s.vrf, COALESCE(host(s.gateway), '')::text AS gateway, s.description, s.site_id,
       v.vid, COALESCE(v.name, '')::text AS vlan_name, COALESCE(v.color, '')::text AS vlan_color
FROM subnets s
LEFT JOIN vlans v ON v.id = s.vlan_id AND v.organization_id = s.organization_id
WHERE s.organization_id = @organization_id AND s.id = ANY (@ids::uuid[])
ORDER BY s.cidr;
