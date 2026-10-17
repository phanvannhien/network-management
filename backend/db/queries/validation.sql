-- Validation context of a diagram (P1-20): what the rules need about the objects on it, plus conflicts computed
-- org-wide. Every query takes organization_id.

-- name: ValidationDevices :many
SELECT id, hostname, type, serial_number, model, firmware, lifecycle, cluster_id, site_id, location_id, mgmt_interface_id
FROM devices
WHERE organization_id = @organization_id AND id = ANY (@ids::uuid[]) AND deleted_at IS NULL;

-- name: ValidationInterfaces :many
-- Only the ports a rule can look at (cabled, addressed, LAG, VLAN mode): a 48-port switch rarely needs all 48.
SELECT i.id, i.device_id, i.name, i.kind, i.media, i.speed, i.mode, i.access_vlan, i.native_vlan, i.allowed_vlans, i.lag_id
FROM interfaces i
WHERE i.organization_id = @organization_id AND i.device_id = ANY (@ids::uuid[])
  AND (i.mode <> '' OR i.lag_id IS NOT NULL OR i.kind = 'lag'
    OR EXISTS (SELECT 1 FROM links l WHERE l.organization_id = i.organization_id AND (l.a_interface_id = i.id OR l.b_interface_id = i.id))
    OR EXISTS (SELECT 1 FROM ip_addresses ip WHERE ip.organization_id = i.organization_id AND ip.interface_id = i.id))
ORDER BY i.sort_order, i.name;

-- name: ValidationIps :many
SELECT device_id, interface_id, address::text AS address, vrf, role
FROM ip_addresses
WHERE organization_id = @organization_id AND device_id = ANY (@ids::uuid[]);

-- name: ValidationLinks :many
-- Every cable touching the objects, also those drawn on no diagram (a port taken elsewhere is still taken).
SELECT id, kind, a_kind, a_id, a_interface_id, b_kind, b_id, b_interface_id
FROM links
WHERE organization_id = @organization_id AND (a_id = ANY (@ids::uuid[]) OR b_id = ANY (@ids::uuid[]));

-- name: ValidationSubnets :many
SELECT id, cidr::text AS cidr, vrf, COALESCE(host(gateway), '')::text AS gateway
FROM subnets
WHERE organization_id = @organization_id;

-- name: ValidationGroups :many
SELECT g.id, g.name, COALESCE(host(r.start_ip), '')::text AS range_start, COALESCE(host(r.end_ip), '')::text AS range_end
FROM endpoint_groups g
LEFT JOIN ip_ranges r ON r.id = g.ip_range_id
WHERE g.organization_id = @organization_id AND g.id = ANY (@ids::uuid[]);

-- name: ValidationGroupMembers :many
SELECT group_id, name, host(ip)::text AS ip
FROM endpoint_members
WHERE organization_id = @organization_id AND group_id = ANY (@ids::uuid[]) AND ip IS NOT NULL;

-- name: DuplicateHostnames :many
-- Another live device with the same name, except members of the same cluster and provider clouds (ADR-027, ADR-033).
SELECT d.id, o.hostname AS other
FROM devices d
JOIN devices o ON o.organization_id = d.organization_id AND o.id <> d.id AND o.deleted_at IS NULL
  AND lower(o.hostname) = lower(d.hostname) AND o.type <> 'provider_cloud'
  AND (d.cluster_id IS NULL OR o.cluster_id IS DISTINCT FROM d.cluster_id)
WHERE d.organization_id = @organization_id AND d.id = ANY (@ids::uuid[]) AND d.deleted_at IS NULL
  AND d.type <> 'provider_cloud';

-- name: DuplicateSerials :many
-- Same serial (trimmed, case-insensitive) on another live device; empty and placeholder values do not count.
SELECT d.id, o.hostname AS other, d.serial_number
FROM devices d
JOIN devices o ON o.organization_id = d.organization_id AND o.id <> d.id AND o.deleted_at IS NULL
  AND o.lifecycle <> 'retired' AND lower(btrim(o.serial_number)) = lower(btrim(d.serial_number))
WHERE d.organization_id = @organization_id AND d.id = ANY (@ids::uuid[]) AND d.deleted_at IS NULL
  AND d.lifecycle <> 'retired'
  AND lower(btrim(d.serial_number)) NOT IN ('', '-', 'n/a', 'na', 'none', 'unknown', 'tbd', '0');

-- name: DuplicateIps :many
-- An address of a device on the diagram that another holder uses in the same VRF. Holders are grouped by owner: the
-- members of a cluster and its VIP are one owner (ADR-027); retired devices and IPv6 link-local do not count. Error when
-- both copies are interface addresses of active devices; a NAT / public copy (PAT behind one WAN IP is normal) or a
-- planned / spare / RMA device makes it a warning.
WITH holders AS (
  SELECT ip.vrf, host(ip.address)::inet AS h, ip.role, d.id AS device_id, COALESCE(d.cluster_id, d.id) AS owner,
         d.hostname AS name, COALESCE(i.name, '') AS iface, d.lifecycle
  FROM ip_addresses ip
  JOIN devices d ON d.id = ip.device_id AND d.deleted_at IS NULL AND d.lifecycle <> 'retired'
  LEFT JOIN interfaces i ON i.id = ip.interface_id
  WHERE ip.organization_id = @organization_id AND NOT ip.address << 'fe80::/10'::inet
  UNION ALL
  SELECT '', host(c.mgmt_ip)::inet, 'primary', NULL::uuid, c.id, COALESCE(NULLIF(c.hostname, ''), c.name), '', 'active'
  FROM device_clusters c
  WHERE c.organization_id = @organization_id AND c.mgmt_ip IS NOT NULL
  UNION ALL
  SELECT COALESCE(sn.vrf, ''), em.ip, 'primary', NULL::uuid, em.id, em.name, g.name, 'active'
  FROM endpoint_members em
  JOIN endpoint_groups g ON g.id = em.group_id
  LEFT JOIN ip_ranges r ON r.id = g.ip_range_id
  LEFT JOIN subnets sn ON sn.id = r.subnet_id
  WHERE em.organization_id = @organization_id AND em.ip IS NOT NULL
)
SELECT m.device_id::uuid AS device_id, host(m.h)::text AS address, m.vrf::text AS vrf, o.name::text AS other,
       o.iface::text AS other_interface,
       (CASE WHEN m.role IN ('primary', 'secondary') AND o.role IN ('primary', 'secondary')
              AND m.lifecycle = 'active' AND o.lifecycle = 'active' THEN 'error' ELSE 'warning' END)::text AS severity
FROM holders m
JOIN holders o ON o.vrf = m.vrf AND o.h = m.h AND o.owner <> m.owner
WHERE m.device_id = ANY (@ids::uuid[]);
