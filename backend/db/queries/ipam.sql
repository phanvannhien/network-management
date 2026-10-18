-- IPAM (P1-10, SRS §5, ADR-014). Every query takes organization_id. VLANs and subnets of a site follow the site's
-- visibility (ADR-031); site-less ones are for organization-wide roles. Interface IPs carry a `visible` flag so callers
-- can count addresses of devices they may not see without showing them.

-- name: ListVlans :many
SELECT v.*, COALESCE(s.code, '')::text AS site_code,
       (SELECT count(*) FROM subnets sn WHERE sn.vlan_id = v.id)::bigint AS subnet_count
FROM vlans v
LEFT JOIN sites s ON s.id = v.site_id AND s.deleted_at IS NULL
WHERE v.organization_id = @organization_id AND (v.site_id IS NULL OR s.id IS NOT NULL)
  AND (sqlc.narg('site_filter')::uuid IS NULL OR v.site_id = sqlc.narg('site_filter') OR v.site_id IS NULL)
ORDER BY s.code NULLS FIRST, v.vid;

-- name: GetVlan :one
SELECT v.*, COALESCE(s.code, '')::text AS site_code,
       (SELECT count(*) FROM subnets sn WHERE sn.vlan_id = v.id)::bigint AS subnet_count
FROM vlans v
LEFT JOIN sites s ON s.id = v.site_id AND s.deleted_at IS NULL
WHERE v.id = @id AND v.organization_id = @organization_id AND (v.site_id IS NULL OR s.id IS NOT NULL);

-- name: CreateVlan :one
INSERT INTO vlans (organization_id, site_id, vid, name, color, description)
VALUES (@organization_id, sqlc.narg('site_id'), @vid, @name, @color, @description)
RETURNING id;

-- name: UpdateVlan :execrows
UPDATE vlans SET site_id = sqlc.narg('site_id'), vid = @vid, name = @name, color = @color, description = @description,
  version = version + 1
WHERE id = @id AND organization_id = @organization_id AND version = @version;

-- name: DeleteVlan :execrows
DELETE FROM vlans WHERE id = @id AND organization_id = @organization_id;

-- name: ListSubnets :many
SELECT sn.*, COALESCE(s.code, '')::text AS site_code,
       v.vid AS vlan_vid, COALESCE(v.name, '')::text AS vlan_name, COALESCE(v.color, '')::text AS vlan_color,
       (SELECT count(DISTINCT a.host) FROM ipam_addresses a
         WHERE a.organization_id = sn.organization_id AND a.vrf = sn.vrf AND a.host << sn.cidr)::bigint AS used_count,
       (SELECT count(*) FROM ip_ranges r WHERE r.subnet_id = sn.id)::bigint AS range_count
FROM subnets sn
LEFT JOIN sites s ON s.id = sn.site_id AND s.deleted_at IS NULL
LEFT JOIN vlans v ON v.id = sn.vlan_id
WHERE sn.organization_id = @organization_id AND (sn.site_id IS NULL OR s.id IS NOT NULL)
  AND (sqlc.narg('site_filter')::uuid IS NULL OR sn.site_id = sqlc.narg('site_filter'))
  AND (sqlc.narg('vlan_filter')::uuid IS NULL OR sn.vlan_id = sqlc.narg('vlan_filter'))
  AND (@q::text = '' OR sn.cidr::text LIKE @q || '%' OR sn.description ILIKE '%' || @q || '%')
ORDER BY sn.vrf, sn.cidr;

-- name: GetSubnet :one
SELECT sn.*, COALESCE(s.code, '')::text AS site_code,
       v.vid AS vlan_vid, COALESCE(v.name, '')::text AS vlan_name, COALESCE(v.color, '')::text AS vlan_color,
       (SELECT count(DISTINCT a.host) FROM ipam_addresses a
         WHERE a.organization_id = sn.organization_id AND a.vrf = sn.vrf AND a.host << sn.cidr)::bigint AS used_count,
       (SELECT count(*) FROM ip_ranges r WHERE r.subnet_id = sn.id)::bigint AS range_count
FROM subnets sn
LEFT JOIN sites s ON s.id = sn.site_id AND s.deleted_at IS NULL
LEFT JOIN vlans v ON v.id = sn.vlan_id
WHERE sn.id = @id AND sn.organization_id = @organization_id AND (sn.site_id IS NULL OR s.id IS NOT NULL);

-- name: CreateSubnet :one
INSERT INTO subnets (organization_id, site_id, vlan_id, cidr, vrf, gateway, description)
VALUES (@organization_id, sqlc.narg('site_id'), sqlc.narg('vlan_id'), @cidr, @vrf, sqlc.narg('gateway'), @description)
RETURNING id;

-- name: UpdateSubnet :execrows
UPDATE subnets SET site_id = sqlc.narg('site_id'), vlan_id = sqlc.narg('vlan_id'), cidr = @cidr, vrf = @vrf,
  gateway = sqlc.narg('gateway'), description = @description, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND version = @version;

-- name: DeleteSubnet :execrows
DELETE FROM subnets WHERE id = @id AND organization_id = @organization_id;

-- name: ListSubnetIPs :many
-- Addresses in use inside a subnet (same VRF), with whether the caller may see the device / cluster.
SELECT a.host::inet AS host, a.address::text AS address, a.role::text AS role, a.vrf::text AS vrf, a.device_id,
       a.cluster_id, a.group_id, a.hostname::text AS hostname, a.interface_name::text AS interface_name,
       true::boolean AS visible
FROM ipam_addresses a
JOIN sites ds ON ds.id = a.site_id AND ds.deleted_at IS NULL
WHERE a.organization_id = @organization_id AND a.vrf = @vrf AND a.host << @cidr::cidr
ORDER BY a.host, a.hostname;

-- name: ListRanges :many
SELECT * FROM ip_ranges WHERE organization_id = @organization_id AND subnet_id = @subnet_id ORDER BY start_ip;

-- name: GetRange :one
SELECT * FROM ip_ranges WHERE id = @id AND organization_id = @organization_id AND subnet_id = @subnet_id;

-- name: CreateRange :one
INSERT INTO ip_ranges (organization_id, subnet_id, start_ip, end_ip, kind, purpose)
VALUES (@organization_id, @subnet_id, @start_ip, @end_ip, @kind, @purpose)
RETURNING *;

-- name: UpdateRange :one
UPDATE ip_ranges SET start_ip = @start_ip, end_ip = @end_ip, kind = @kind, purpose = @purpose, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND subnet_id = @subnet_id AND version = @version
RETURNING *;

-- name: DeleteRange :execrows
DELETE FROM ip_ranges WHERE id = @id AND organization_id = @organization_id AND subnet_id = @subnet_id;

-- name: LookupSubnets :many
-- Subnets containing the address (any VRF), most specific first.
SELECT sn.*, COALESCE(s.code, '')::text AS site_code,
       v.vid AS vlan_vid, COALESCE(v.name, '')::text AS vlan_name, COALESCE(v.color, '')::text AS vlan_color,
       (SELECT count(DISTINCT a.host) FROM ipam_addresses a
         WHERE a.organization_id = sn.organization_id AND a.vrf = sn.vrf AND a.host << sn.cidr)::bigint AS used_count,
       (SELECT count(*) FROM ip_ranges r WHERE r.subnet_id = sn.id)::bigint AS range_count
FROM subnets sn
LEFT JOIN sites s ON s.id = sn.site_id AND s.deleted_at IS NULL
LEFT JOIN vlans v ON v.id = sn.vlan_id
WHERE sn.organization_id = @organization_id AND (sn.site_id IS NULL OR s.id IS NOT NULL) AND sn.cidr >>= @ip::inet
ORDER BY masklen(sn.cidr) DESC, sn.vrf;

-- name: LookupIPs :many
-- Interfaces and clusters holding the address (any VRF).
SELECT a.host::inet AS host, a.address::text AS address, a.role::text AS role, a.vrf::text AS vrf, a.device_id,
       a.cluster_id, a.group_id, a.hostname::text AS hostname, a.interface_name::text AS interface_name,
       true::boolean AS visible
FROM ipam_addresses a
JOIN sites ds ON ds.id = a.site_id AND ds.deleted_at IS NULL
WHERE a.organization_id = @organization_id AND a.host = @ip::inet
ORDER BY a.hostname;

-- name: FindSubnetID :one
-- IPAM import (P2-09): the subnet a row means (same VRF and CIDR).
SELECT id FROM subnets WHERE organization_id = @organization_id AND vrf = @vrf AND cidr = @cidr::cidr;

-- name: FindVlanID :one
-- IPAM import: the VLAN a row means — the site's own (or the organization-wide one when no site).
SELECT id FROM vlans
WHERE organization_id = @organization_id AND vid = @vid
  AND site_id IS NOT DISTINCT FROM sqlc.narg('site_id')::uuid;

-- name: ImportSites :many
-- IPAM import: live sites by full code, own code and name (matched case-insensitively).
SELECT id, code::text AS code, local_code, name FROM sites WHERE organization_id = @organization_id AND deleted_at IS NULL;

-- name: SubnetHolding :one
-- IPAM import: the most specific subnet of a VRF holding both addresses (a range row without a subnet column).
SELECT id FROM subnets
WHERE organization_id = @organization_id AND vrf = @vrf AND cidr >>= @first_ip::inet AND cidr >>= @last_ip::inet
ORDER BY masklen(cidr) DESC LIMIT 1;
