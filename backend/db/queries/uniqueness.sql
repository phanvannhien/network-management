-- Uniqueness checked on write (ADR-038): serial numbers and addresses. The check takes a transaction-scoped advisory
-- lock on the value first, so two concurrent writes of the same value cannot both pass.

-- name: LockValue :exec
-- key: organization id, kind and value, built by the caller.
SELECT pg_advisory_xact_lock(hashtextextended(@key::text, 0));

-- name: SerialHolders :many
-- Live, not retired devices with this serial (trimmed, case-insensitive).
SELECT d.id, d.hostname
FROM devices d
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL AND d.lifecycle <> 'retired'
  AND lower(d.serial_number) = lower(btrim(@serial::text)) AND d.id IS DISTINCT FROM sqlc.narg('self')::uuid
LIMIT 3;

-- name: AddressHolders :many
-- Every holder of a host address in a VRF: interface / NAT addresses of live devices, cluster shared IPs (VRF ''),
-- endpoint group members (VRF of their range's subnet).
SELECT 'ip'::text AS kind, ip.id, ip.role, ip.device_id, d.cluster_id, NULL::uuid AS member_id, d.hostname::text AS name,
       d.lifecycle, COALESCE(i.name, '')::text AS interface_name
FROM ip_addresses ip
JOIN devices d ON d.id = ip.device_id AND d.deleted_at IS NULL
LEFT JOIN interfaces i ON i.id = ip.interface_id
WHERE ip.organization_id = @organization_id AND ip.vrf = @vrf AND host(ip.address)::inet = @host::inet
UNION ALL
SELECT 'cluster', c.id, 'primary', NULL::uuid, c.id, NULL::uuid, COALESCE(NULLIF(c.hostname, ''), c.name)::text, 'active', ''
FROM device_clusters c
WHERE c.organization_id = @organization_id AND @vrf = '' AND host(c.mgmt_ip)::inet = @host::inet
UNION ALL
SELECT 'member', em.id, 'primary', NULL::uuid, NULL::uuid, em.id, (g.name || ' · ' || em.name)::text, 'active', ''
FROM endpoint_members em
JOIN endpoint_groups g ON g.id = em.group_id
LEFT JOIN ip_ranges r ON r.id = g.ip_range_id
LEFT JOIN subnets sn ON sn.id = r.subnet_id
WHERE em.organization_id = @organization_id AND COALESCE(sn.vrf, '') = @vrf AND em.ip = @host::inet;

-- name: GroupVrf :one
-- The VRF of an endpoint group's members: that of its range's subnet, '' without one.
SELECT COALESCE(sn.vrf, '')::text
FROM endpoint_groups g
LEFT JOIN ip_ranges r ON r.id = g.ip_range_id
LEFT JOIN subnets sn ON sn.id = r.subnet_id
WHERE g.id = @id AND g.organization_id = @organization_id;

-- name: HostnamePrefixTaken :one
-- A live device whose hostname starts with this prefix ("VP-"): design templates then use the full site code.
SELECT EXISTS (SELECT 1 FROM devices WHERE organization_id = @organization_id AND deleted_at IS NULL
                 AND lower(hostname) LIKE lower(@prefix::text) || '%')::boolean;
