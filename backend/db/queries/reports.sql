-- Reports (P2-11): read-only listings for the Reports page and its Excel files. Scope: the topbar category (with its
-- subtree) and / or one site; organization-wide rows (site NULL) apply everywhere and are always in.

-- name: ReportSubnets :many
SELECT sn.id, sn.cidr, sn.vrf, sn.gateway, sn.description,
       COALESCE(s.code, '')::text AS site_code, COALESCE(s.name, '')::text AS site_name,
       v.vid AS vlan_vid, COALESCE(v.name, '')::text AS vlan_name,
       (SELECT count(DISTINCT a.host) FROM ipam_addresses a
         WHERE a.organization_id = sn.organization_id AND a.vrf = sn.vrf AND a.host << sn.cidr)::bigint AS used_count
FROM subnets sn
LEFT JOIN sites s ON s.id = sn.site_id AND s.deleted_at IS NULL
LEFT JOIN vlans v ON v.id = sn.vlan_id
WHERE sn.organization_id = @organization_id AND (sn.site_id IS NULL OR s.id IS NOT NULL)
  AND (sn.site_id IS NULL OR (
        (sqlc.narg('site_filter')::uuid IS NULL OR sn.site_id = sqlc.narg('site_filter'))
    AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))))
ORDER BY s.code NULLS FIRST, v.vid NULLS LAST, sn.vrf, sn.cidr;

-- name: ReportRanges :many
SELECT r.subnet_id, r.kind, r.start_ip, r.end_ip, r.purpose
FROM ip_ranges r
WHERE r.organization_id = @organization_id AND r.subnet_id = ANY (@subnet_ids::uuid[])
ORDER BY r.subnet_id, r.start_ip;

-- name: ReportVlans :many
SELECT v.id, v.vid, v.name, v.description, v.site_id, COALESCE(s.code, '')::text AS site_code,
       COALESCE((SELECT array_agg(sn.cidr::text ORDER BY sn.cidr) FROM subnets sn
                 WHERE sn.organization_id = v.organization_id AND sn.vlan_id = v.id), '{}')::text[] AS subnets,
       COALESCE((SELECT array_agg(host(sn.gateway) ORDER BY sn.cidr) FROM subnets sn
                 WHERE sn.organization_id = v.organization_id AND sn.vlan_id = v.id AND sn.gateway IS NOT NULL), '{}')::text[] AS gateways
FROM vlans v
LEFT JOIN sites s ON s.id = v.site_id AND s.deleted_at IS NULL
WHERE v.organization_id = @organization_id AND (v.site_id IS NULL OR s.id IS NOT NULL)
  AND (v.site_id IS NULL OR (
        (sqlc.narg('site_filter')::uuid IS NULL OR v.site_id = sqlc.narg('site_filter'))
    AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))))
ORDER BY v.vid, s.code NULLS FIRST;

-- name: ReportVlanPorts :many
-- Switchport settings of the devices in scope (not retired), to count where each VLAN is used.
SELECT d.site_id, i.mode, i.access_vlan, i.native_vlan, i.allowed_vlans
FROM interfaces i
JOIN devices d ON d.id = i.device_id AND d.deleted_at IS NULL AND d.lifecycle <> 'retired'
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE i.organization_id = @organization_id AND i.mode IN ('access', 'trunk', 'hybrid')
  AND (sqlc.narg('site_filter')::uuid IS NULL OR d.site_id = sqlc.narg('site_filter'))
  AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)));

-- name: ReportPorts :many
-- Every port of every device in scope (not retired), free ones too, in the device's port order.
SELECT d.id AS device_id, d.hostname, d.type, d.vendor, d.model, s.code::text AS site_code,
       COALESCE(c.name, '')::text AS cluster_name,
       i.id, i.name, i.kind, i.description, i.admin_up, i.mode, i.access_vlan, i.native_vlan, i.allowed_vlans,
       i.speed, i.duplex, i.media, i.poe, COALESCE(lag.name, '')::text AS lag_name
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
JOIN interfaces i ON i.device_id = d.id AND i.organization_id = d.organization_id
LEFT JOIN interfaces lag ON lag.id = i.lag_id
LEFT JOIN device_clusters c ON c.id = d.cluster_id
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL AND d.lifecycle <> 'retired'
  AND (sqlc.narg('site_filter')::uuid IS NULL OR d.site_id = sqlc.narg('site_filter'))
  AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
ORDER BY s.code, d.hostname, d.id, i.sort_order, i.name;

-- name: ReportPortLinks :many
-- Cables ending on the given ports, with both ends named (device hostname, endpoint group or shared network name).
SELECT l.kind, l.cable_id, l.status, l.a_kind, l.a_interface_id, l.b_kind, l.b_interface_id,
       COALESCE(ad.hostname, ag.name, asg.name, '')::text AS a_name, COALESCE(ai.name, '')::text AS a_port,
       COALESCE(bd.hostname, bg.name, bsg.name, '')::text AS b_name, COALESCE(bi.name, '')::text AS b_port
FROM links l
LEFT JOIN devices ad ON l.a_kind = 'device' AND ad.id = l.a_id
LEFT JOIN endpoint_groups ag ON l.a_kind = 'endpoint_group' AND ag.id = l.a_id
LEFT JOIN segments asg ON l.a_kind = 'segment' AND asg.id = l.a_id
LEFT JOIN interfaces ai ON ai.id = l.a_interface_id
LEFT JOIN devices bd ON l.b_kind = 'device' AND bd.id = l.b_id
LEFT JOIN endpoint_groups bg ON l.b_kind = 'endpoint_group' AND bg.id = l.b_id
LEFT JOIN segments bsg ON l.b_kind = 'segment' AND bsg.id = l.b_id
LEFT JOIN interfaces bi ON bi.id = l.b_interface_id
WHERE l.organization_id = @organization_id
  AND (l.a_interface_id = ANY (@port_ids::uuid[]) OR l.b_interface_id = ANY (@port_ids::uuid[]));

-- name: ReportBoq :many
-- Our physical boxes in scope by status / vendor / model / part number / type / site. Not counted: retired / RMA,
-- someone else's (managed = false: ISP modem…), the provider cloud and VMs.
SELECT d.lifecycle, d.vendor, d.model, d.part_number, d.type, s.code::text AS site_code,
       count(*)::bigint AS quantity, count(d.cluster_id)::bigint AS clustered
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  AND d.lifecycle IN ('planned', 'active', 'spare') AND d.managed AND d.type NOT IN ('provider_cloud', 'vm')
  AND (sqlc.narg('site_filter')::uuid IS NULL OR d.site_id = sqlc.narg('site_filter'))
  AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
GROUP BY d.lifecycle, d.vendor, d.model, d.part_number, d.type, s.code
ORDER BY d.lifecycle, d.vendor, d.model, d.part_number, s.code;
