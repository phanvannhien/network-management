-- Endpoint groups (P1-11, SRS §4.4). Every query takes organization_id; visibility follows devices (ADR-031):
-- the group's unit is granted, or its site is visible.

-- name: ListEndpointGroups :many
SELECT g.*, s.code AS site_code, s.name AS site_name, s.business_unit_id AS site_unit_id, sb.partner_id AS site_partner_id,
       gu.code AS unit_code, gu.partner_id, gp.code AS partner_code,
       r.start_ip AS range_start, r.end_ip AS range_end, COALESCE(r.kind, '')::text AS range_kind,
       COALESCE(r.purpose, '')::text AS range_purpose, r.subnet_id, sn.cidr AS subnet_cidr,
       COALESCE(sn.vrf, '')::text AS subnet_vrf,
       (SELECT count(*) FROM endpoint_members em WHERE em.group_id = g.id)::bigint AS member_count
FROM endpoint_groups g
JOIN sites s ON s.id = g.site_id AND s.deleted_at IS NULL
JOIN business_units gu ON gu.id = g.business_unit_id
JOIN partners gp ON gp.id = gu.partner_id
LEFT JOIN business_units sb ON sb.id = s.business_unit_id
LEFT JOIN ip_ranges r ON r.id = g.ip_range_id
LEFT JOIN subnets sn ON sn.id = r.subnet_id
WHERE g.organization_id = @organization_id
  AND (sqlc.narg('site_filter')::uuid IS NULL OR g.site_id = sqlc.narg('site_filter'))
  AND (NOT @restricted::boolean
       OR g.business_unit_id = ANY (@grant_units::uuid[]) OR gu.partner_id = ANY (@grant_partners::uuid[])
       OR sb.id = ANY (@grant_units::uuid[]) OR sb.partner_id = ANY (@grant_partners::uuid[])
       OR EXISTS (SELECT 1 FROM resource_shares rs
                  LEFT JOIN business_units tu ON tu.id = rs.target_unit_id AND tu.deleted_at IS NULL
                  WHERE rs.organization_id = s.organization_id AND rs.resource_type = 'site' AND rs.resource_id = s.id
                    AND (rs.target_partner_id = ANY (@share_partners::uuid[])
                         OR rs.target_unit_id = ANY (@grant_units::uuid[])
                         OR tu.partner_id = ANY (@grant_partners::uuid[]))))
ORDER BY s.code, lower(g.name);

-- name: GetEndpointGroup :one
SELECT g.*, s.code AS site_code, s.name AS site_name, s.business_unit_id AS site_unit_id, sb.partner_id AS site_partner_id,
       gu.code AS unit_code, gu.partner_id, gp.code AS partner_code,
       r.start_ip AS range_start, r.end_ip AS range_end, COALESCE(r.kind, '')::text AS range_kind,
       COALESCE(r.purpose, '')::text AS range_purpose, r.subnet_id, sn.cidr AS subnet_cidr,
       COALESCE(sn.vrf, '')::text AS subnet_vrf,
       (SELECT count(*) FROM endpoint_members em WHERE em.group_id = g.id)::bigint AS member_count
FROM endpoint_groups g
JOIN sites s ON s.id = g.site_id AND s.deleted_at IS NULL
JOIN business_units gu ON gu.id = g.business_unit_id
JOIN partners gp ON gp.id = gu.partner_id
LEFT JOIN business_units sb ON sb.id = s.business_unit_id
LEFT JOIN ip_ranges r ON r.id = g.ip_range_id
LEFT JOIN subnets sn ON sn.id = r.subnet_id
WHERE g.id = @id AND g.organization_id = @organization_id
  AND (NOT @restricted::boolean
       OR g.business_unit_id = ANY (@grant_units::uuid[]) OR gu.partner_id = ANY (@grant_partners::uuid[])
       OR sb.id = ANY (@grant_units::uuid[]) OR sb.partner_id = ANY (@grant_partners::uuid[])
       OR EXISTS (SELECT 1 FROM resource_shares rs
                  LEFT JOIN business_units tu ON tu.id = rs.target_unit_id AND tu.deleted_at IS NULL
                  WHERE rs.organization_id = s.organization_id AND rs.resource_type = 'site' AND rs.resource_id = s.id
                    AND (rs.target_partner_id = ANY (@share_partners::uuid[])
                         OR rs.target_unit_id = ANY (@grant_units::uuid[])
                         OR tu.partner_id = ANY (@grant_partners::uuid[]))));

-- name: CreateEndpointGroup :one
INSERT INTO endpoint_groups (organization_id, business_unit_id, site_id, kind, name, ip_range_id, expected_count, notes)
VALUES (@organization_id, @business_unit_id, @site_id, @kind, @name, sqlc.narg('ip_range_id'),
        sqlc.narg('expected_count'), @notes)
RETURNING id;

-- name: UpdateEndpointGroup :execrows
UPDATE endpoint_groups SET business_unit_id = @business_unit_id, site_id = @site_id, kind = @kind, name = @name,
  ip_range_id = sqlc.narg('ip_range_id'), expected_count = sqlc.narg('expected_count'), notes = @notes,
  version = version + 1
WHERE id = @id AND organization_id = @organization_id AND version = @version;

-- name: DeleteEndpointGroup :execrows
DELETE FROM endpoint_groups WHERE id = @id AND organization_id = @organization_id;

-- name: ListEndpointMembers :many
SELECT em.*, COALESCE(i.name, '')::text AS interface_name, i.device_id AS port_device_id,
       COALESCE(d.hostname, '')::text AS port_hostname
FROM endpoint_members em
LEFT JOIN interfaces i ON i.id = em.interface_id
LEFT JOIN devices d ON d.id = i.device_id AND d.deleted_at IS NULL
WHERE em.organization_id = @organization_id AND em.group_id = @group_id
ORDER BY em.ip NULLS LAST, lower(em.name);

-- name: GetEndpointMember :one
SELECT * FROM endpoint_members WHERE id = @id AND organization_id = @organization_id AND group_id = @group_id;

-- name: CreateEndpointMember :one
INSERT INTO endpoint_members (organization_id, group_id, name, ip, mac, interface_id, notes)
VALUES (@organization_id, @group_id, @name, sqlc.narg('ip'), sqlc.narg('mac'), sqlc.narg('interface_id'), @notes)
RETURNING id;

-- name: UpdateEndpointMember :execrows
UPDATE endpoint_members SET name = @name, ip = sqlc.narg('ip'), mac = sqlc.narg('mac'),
  interface_id = sqlc.narg('interface_id'), notes = @notes, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND group_id = @group_id AND version = @version;

-- name: DeleteEndpointMember :execrows
DELETE FROM endpoint_members WHERE id = @id AND organization_id = @organization_id AND group_id = @group_id;

-- name: GetRangeWithSubnet :one
-- A planned range and its subnet, to link a group to it.
SELECT r.*, sn.cidr AS subnet_cidr, sn.vrf AS subnet_vrf, sn.site_id AS subnet_site_id
FROM ip_ranges r JOIN subnets sn ON sn.id = r.subnet_id
WHERE r.id = @id AND r.organization_id = @organization_id;

-- name: GetPortInterface :one
-- A switch port a member may plug into: an interface of a live device in the organization.
SELECT i.id, i.name, i.kind, d.id AS device_id, d.hostname, d.site_id
FROM interfaces i JOIN devices d ON d.id = i.device_id AND d.deleted_at IS NULL
WHERE i.id = @id AND i.organization_id = @organization_id;

-- name: SetDeviceMgmtInterface :exec
UPDATE devices SET mgmt_interface_id = @interface_id WHERE id = @id AND organization_id = @organization_id;

-- name: CountEndpointGroupsInSite :one
SELECT count(*) FROM endpoint_groups WHERE organization_id = @organization_id AND site_id = @site_id;

-- name: CountEndpointGroupsOfUnit :one
SELECT count(*) FROM endpoint_groups WHERE organization_id = @organization_id AND business_unit_id = @business_unit_id;
