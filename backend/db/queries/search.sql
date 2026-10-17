-- Global search (P1-23, SRS §2): hostname, S/N, part number, model, IP, MAC, cluster, endpoint group (sites and
-- categories are matched in the browser, all of them are loaded). Every query takes
-- organization_id; results are capped by @lim.

-- name: SearchDevices :many
SELECT d.id, d.hostname, d.type, d.serial_number, d.part_number, d.model, d.asset_tag, s.code::text AS site_code,
       CASE WHEN lower(d.hostname) LIKE '%' || lower(@q::text) || '%' THEN 'hostname'
            WHEN lower(d.serial_number) LIKE '%' || lower(@q::text) || '%' THEN 'serial'
            WHEN lower(d.part_number) LIKE '%' || lower(@q::text) || '%' THEN 'partNumber'
            WHEN lower(d.asset_tag) LIKE '%' || lower(@q::text) || '%' THEN 'assetTag'
            ELSE 'model' END::text AS matched
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  AND (lower(d.hostname) LIKE '%' || lower(@q::text) || '%' OR lower(d.serial_number) LIKE '%' || lower(@q::text) || '%'
    OR lower(d.part_number) LIKE '%' || lower(@q::text) || '%' OR lower(d.model) LIKE '%' || lower(@q::text) || '%'
    OR lower(d.asset_tag) LIKE '%' || lower(@q::text) || '%')
ORDER BY (lower(d.hostname) = lower(@q::text)) DESC, (lower(d.hostname) LIKE lower(@q::text) || '%') DESC, lower(d.hostname)
LIMIT @lim;

-- name: SearchIPs :many
-- Addresses held by devices, cluster VIPs and endpoint group members starting with the text being typed ("10.136.").
SELECT host(a.host)::text AS host, a.address, a.role, a.device_id, a.cluster_id, a.group_id, a.hostname, a.interface_name,
       COALESCE(s.code, '')::text AS site_code
FROM ipam_addresses a
LEFT JOIN sites s ON s.id = a.site_id AND s.deleted_at IS NULL
WHERE a.organization_id = @organization_id AND host(a.host) LIKE @q::text || '%'
ORDER BY a.host
LIMIT @lim;

-- name: SearchIPsIn :many
-- The same, inside a prefix: one exact address (a /32 or /128) or every address of a subnet ("10.136.10.0/24").
SELECT host(a.host)::text AS host, a.address, a.role, a.device_id, a.cluster_id, a.group_id, a.hostname, a.interface_name,
       COALESCE(s.code, '')::text AS site_code
FROM ipam_addresses a
LEFT JOIN sites s ON s.id = a.site_id AND s.deleted_at IS NULL
WHERE a.organization_id = @organization_id AND a.host <<= @cidr::cidr
ORDER BY a.host
LIMIT @lim;

-- name: SearchMACs :many
-- Interfaces and endpoint group members by MAC, compared as bare hex (any of aa:bb:cc…, aabb.cc…, aa-bb-cc…).
SELECT i.device_id, d.hostname, i.name AS interface_name, i.mac::text AS mac, NULL::uuid AS group_id
FROM interfaces i
JOIN devices d ON d.id = i.device_id AND d.deleted_at IS NULL
WHERE i.organization_id = @organization_id AND i.mac IS NOT NULL AND replace(i.mac::text, ':', '') LIKE '%' || @hex::text || '%'
UNION ALL
-- For a group member: hostname = the member's name, interface_name = the group's name.
SELECT NULL::uuid, em.name, g.name, em.mac::text, g.id
FROM endpoint_members em
JOIN endpoint_groups g ON g.id = em.group_id
WHERE em.organization_id = @organization_id AND em.mac IS NOT NULL AND replace(em.mac::text, ':', '') LIKE '%' || @hex::text || '%'
ORDER BY 4
LIMIT @lim;

-- name: SearchGroups :many
SELECT g.id, g.name, g.kind, s.code::text AS site_code
FROM endpoint_groups g
JOIN sites s ON s.id = g.site_id AND s.deleted_at IS NULL
WHERE g.organization_id = @organization_id AND lower(g.name) LIKE '%' || lower(@q::text) || '%'
ORDER BY lower(g.name)
LIMIT @lim;

-- name: SearchClusters :many
-- Stacks / HA pairs / VCs by name or hostname (their VIP is found by SearchIPs).
SELECT c.id, c.name, c.kind, c.hostname, s.code::text AS site_code
FROM device_clusters c
JOIN sites s ON s.id = c.site_id AND s.deleted_at IS NULL
WHERE c.organization_id = @organization_id
  AND (lower(c.name) LIKE '%' || lower(@q::text) || '%' OR lower(c.hostname) LIKE '%' || lower(@q::text) || '%')
ORDER BY lower(c.name)
LIMIT @lim;

-- name: SearchClusterMembers :many
-- Live members of the clusters: a cluster is drawn through its members.
SELECT d.cluster_id, d.id
FROM devices d
WHERE d.organization_id = @organization_id AND d.cluster_id = ANY (@cluster_ids::uuid[]) AND d.deleted_at IS NULL;
