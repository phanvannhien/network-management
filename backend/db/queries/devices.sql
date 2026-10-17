-- Devices (P1-08, SRS §4.1). Every query takes organization_id. A device's category is its site's (ADR-032).
-- mgmt_ip: the primary IP of the device's management interface, else its cluster's shared management IP (ADR-027).

-- name: ListDevices :many
SELECT d.*, s.code::text AS site_code, s.name AS site_name, s.category_id,
       category_path(s.category_id)::text AS category_path,
       COALESCE(l.name, '')::text AS location_name, COALESCE(r.name, '')::text AS rack_name,
       COALESCE(mi.name, '')::text AS mgmt_interface_name,
       COALESCE(dc.name, '')::text AS cluster_name, COALESCE(dc.kind, '')::text AS cluster_kind,
       COALESCE((SELECT ip.address::text FROM ip_addresses ip
                 WHERE ip.interface_id = d.mgmt_interface_id AND ip.role = 'primary'
                 ORDER BY family(ip.address) LIMIT 1), dc.mgmt_ip::text, '')::text AS mgmt_ip
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
LEFT JOIN locations l ON l.id = d.location_id
LEFT JOIN racks r ON r.id = d.rack_id
LEFT JOIN interfaces mi ON mi.id = d.mgmt_interface_id
LEFT JOIN device_clusters dc ON dc.id = d.cluster_id
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%')
       OR EXISTS (SELECT 1 FROM interfaces ifq WHERE ifq.device_id = d.id AND ifq.mac::text LIKE lower(@q) || '%')
       OR EXISTS (SELECT 1 FROM device_clusters cq WHERE cq.id = d.cluster_id AND host(cq.mgmt_ip) LIKE @q || '%'))
  AND (COALESCE(cardinality(@cluster_ids::uuid[]), 0) = 0 OR d.cluster_id = ANY (@cluster_ids::uuid[]))
  AND (sqlc.narg('category_filter')::uuid IS NULL
       OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
  AND (COALESCE(cardinality(@site_ids::uuid[]), 0) = 0 OR d.site_id = ANY (@site_ids::uuid[]))
  AND (COALESCE(cardinality(@types::text[]), 0) = 0 OR d.type = ANY (@types::text[]))
  AND (COALESCE(cardinality(@vendors::text[]), 0) = 0 OR d.vendor = ANY (@vendors::text[]))
  AND (COALESCE(cardinality(@lifecycles::text[]), 0) = 0 OR d.lifecycle = ANY (@lifecycles::text[]))
  AND (COALESCE(cardinality(@roles::text[]), 0) = 0 OR d.role = ANY (@roles::text[]))
  AND (COALESCE(cardinality(@tags::text[]), 0) = 0 OR d.tags && @tags::text[])
ORDER BY
  CASE WHEN NOT @sort_desc::boolean THEN
    CASE @sort_key::text WHEN 'type' THEN d.type WHEN 'vendor' THEN lower(d.vendor) WHEN 'model' THEN lower(d.model)
      WHEN 'site' THEN s.code WHEN 'lifecycle' THEN d.lifecycle WHEN 'serial' THEN lower(d.serial_number)
      WHEN 'category' THEN category_path(s.category_id) ELSE NULL END END ASC NULLS LAST,
  CASE WHEN @sort_desc::boolean THEN
    CASE @sort_key::text WHEN 'type' THEN d.type WHEN 'vendor' THEN lower(d.vendor) WHEN 'model' THEN lower(d.model)
      WHEN 'site' THEN s.code WHEN 'lifecycle' THEN d.lifecycle WHEN 'serial' THEN lower(d.serial_number)
      WHEN 'category' THEN category_path(s.category_id) ELSE NULL END END DESC NULLS LAST,
  CASE WHEN @sort_key::text = 'warranty_end' AND NOT @sort_desc::boolean THEN d.warranty_end END ASC NULLS LAST,
  CASE WHEN @sort_key::text = 'warranty_end' AND @sort_desc::boolean THEN d.warranty_end END DESC NULLS LAST,
  CASE WHEN @sort_key::text = 'mgmt_ip' AND NOT @sort_desc::boolean THEN
    COALESCE((SELECT ip.address FROM ip_addresses ip WHERE ip.interface_id = d.mgmt_interface_id AND ip.role = 'primary'
              ORDER BY family(ip.address) LIMIT 1),
             (SELECT cs.mgmt_ip FROM device_clusters cs WHERE cs.id = d.cluster_id)) END ASC NULLS LAST,
  CASE WHEN @sort_key::text = 'mgmt_ip' AND @sort_desc::boolean THEN
    COALESCE((SELECT ip.address FROM ip_addresses ip WHERE ip.interface_id = d.mgmt_interface_id AND ip.role = 'primary'
              ORDER BY family(ip.address) LIMIT 1),
             (SELECT cs.mgmt_ip FROM device_clusters cs WHERE cs.id = d.cluster_id)) END DESC NULLS LAST,
  CASE WHEN @sort_key::text = 'hostname' AND @sort_desc::boolean THEN lower(d.hostname) END DESC,
  lower(d.hostname), d.id
LIMIT @page_limit OFFSET @page_offset;

-- name: CountDevices :one
SELECT count(*)
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%')
       OR EXISTS (SELECT 1 FROM interfaces ifq WHERE ifq.device_id = d.id AND ifq.mac::text LIKE lower(@q) || '%')
       OR EXISTS (SELECT 1 FROM device_clusters cq WHERE cq.id = d.cluster_id AND host(cq.mgmt_ip) LIKE @q || '%'))
  AND (COALESCE(cardinality(@cluster_ids::uuid[]), 0) = 0 OR d.cluster_id = ANY (@cluster_ids::uuid[]))
  AND (sqlc.narg('category_filter')::uuid IS NULL
       OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
  AND (COALESCE(cardinality(@site_ids::uuid[]), 0) = 0 OR d.site_id = ANY (@site_ids::uuid[]))
  AND (COALESCE(cardinality(@types::text[]), 0) = 0 OR d.type = ANY (@types::text[]))
  AND (COALESCE(cardinality(@vendors::text[]), 0) = 0 OR d.vendor = ANY (@vendors::text[]))
  AND (COALESCE(cardinality(@lifecycles::text[]), 0) = 0 OR d.lifecycle = ANY (@lifecycles::text[]))
  AND (COALESCE(cardinality(@roles::text[]), 0) = 0 OR d.role = ANY (@roles::text[]))
  AND (COALESCE(cardinality(@tags::text[]), 0) = 0 OR d.tags && @tags::text[]);

-- name: DeviceFacetCounts :many
-- Count per facet value over the result filtered by everything except that facet (FilterBar counts).
SELECT 'site'::text AS facet, d.site_id::text AS value, count(*)::bigint AS n
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%')
       OR EXISTS (SELECT 1 FROM interfaces ifq WHERE ifq.device_id = d.id AND ifq.mac::text LIKE lower(@q) || '%')
       OR EXISTS (SELECT 1 FROM device_clusters cq WHERE cq.id = d.cluster_id AND host(cq.mgmt_ip) LIKE @q || '%'))
  AND (COALESCE(cardinality(@cluster_ids::uuid[]), 0) = 0 OR d.cluster_id = ANY (@cluster_ids::uuid[]))
  AND (sqlc.narg('category_filter')::uuid IS NULL
       OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
  AND (COALESCE(cardinality(@types::text[]), 0) = 0 OR d.type = ANY (@types::text[]))
  AND (COALESCE(cardinality(@vendors::text[]), 0) = 0 OR d.vendor = ANY (@vendors::text[]))
  AND (COALESCE(cardinality(@lifecycles::text[]), 0) = 0 OR d.lifecycle = ANY (@lifecycles::text[]))
  AND (COALESCE(cardinality(@roles::text[]), 0) = 0 OR d.role = ANY (@roles::text[]))
  AND (COALESCE(cardinality(@tags::text[]), 0) = 0 OR d.tags && @tags::text[])
GROUP BY 2
UNION ALL
SELECT 'type'::text AS facet, d.type AS value, count(*)::bigint AS n
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%')
       OR EXISTS (SELECT 1 FROM interfaces ifq WHERE ifq.device_id = d.id AND ifq.mac::text LIKE lower(@q) || '%')
       OR EXISTS (SELECT 1 FROM device_clusters cq WHERE cq.id = d.cluster_id AND host(cq.mgmt_ip) LIKE @q || '%'))
  AND (COALESCE(cardinality(@cluster_ids::uuid[]), 0) = 0 OR d.cluster_id = ANY (@cluster_ids::uuid[]))
  AND (sqlc.narg('category_filter')::uuid IS NULL
       OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
  AND (COALESCE(cardinality(@site_ids::uuid[]), 0) = 0 OR d.site_id = ANY (@site_ids::uuid[]))
  AND (COALESCE(cardinality(@vendors::text[]), 0) = 0 OR d.vendor = ANY (@vendors::text[]))
  AND (COALESCE(cardinality(@lifecycles::text[]), 0) = 0 OR d.lifecycle = ANY (@lifecycles::text[]))
  AND (COALESCE(cardinality(@roles::text[]), 0) = 0 OR d.role = ANY (@roles::text[]))
  AND (COALESCE(cardinality(@tags::text[]), 0) = 0 OR d.tags && @tags::text[])
GROUP BY 2
UNION ALL
SELECT 'vendor'::text AS facet, d.vendor AS value, count(*)::bigint AS n
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%')
       OR EXISTS (SELECT 1 FROM interfaces ifq WHERE ifq.device_id = d.id AND ifq.mac::text LIKE lower(@q) || '%')
       OR EXISTS (SELECT 1 FROM device_clusters cq WHERE cq.id = d.cluster_id AND host(cq.mgmt_ip) LIKE @q || '%'))
  AND (COALESCE(cardinality(@cluster_ids::uuid[]), 0) = 0 OR d.cluster_id = ANY (@cluster_ids::uuid[]))
  AND (sqlc.narg('category_filter')::uuid IS NULL
       OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
  AND (COALESCE(cardinality(@site_ids::uuid[]), 0) = 0 OR d.site_id = ANY (@site_ids::uuid[]))
  AND (COALESCE(cardinality(@types::text[]), 0) = 0 OR d.type = ANY (@types::text[]))
  AND (COALESCE(cardinality(@lifecycles::text[]), 0) = 0 OR d.lifecycle = ANY (@lifecycles::text[]))
  AND (COALESCE(cardinality(@roles::text[]), 0) = 0 OR d.role = ANY (@roles::text[]))
  AND (COALESCE(cardinality(@tags::text[]), 0) = 0 OR d.tags && @tags::text[])
GROUP BY 2
UNION ALL
SELECT 'lifecycle'::text AS facet, d.lifecycle AS value, count(*)::bigint AS n
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%')
       OR EXISTS (SELECT 1 FROM interfaces ifq WHERE ifq.device_id = d.id AND ifq.mac::text LIKE lower(@q) || '%')
       OR EXISTS (SELECT 1 FROM device_clusters cq WHERE cq.id = d.cluster_id AND host(cq.mgmt_ip) LIKE @q || '%'))
  AND (COALESCE(cardinality(@cluster_ids::uuid[]), 0) = 0 OR d.cluster_id = ANY (@cluster_ids::uuid[]))
  AND (sqlc.narg('category_filter')::uuid IS NULL
       OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
  AND (COALESCE(cardinality(@site_ids::uuid[]), 0) = 0 OR d.site_id = ANY (@site_ids::uuid[]))
  AND (COALESCE(cardinality(@types::text[]), 0) = 0 OR d.type = ANY (@types::text[]))
  AND (COALESCE(cardinality(@vendors::text[]), 0) = 0 OR d.vendor = ANY (@vendors::text[]))
  AND (COALESCE(cardinality(@roles::text[]), 0) = 0 OR d.role = ANY (@roles::text[]))
  AND (COALESCE(cardinality(@tags::text[]), 0) = 0 OR d.tags && @tags::text[])
GROUP BY 2
UNION ALL
SELECT 'role'::text AS facet, d.role AS value, count(*)::bigint AS n
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%')
       OR EXISTS (SELECT 1 FROM interfaces ifq WHERE ifq.device_id = d.id AND ifq.mac::text LIKE lower(@q) || '%')
       OR EXISTS (SELECT 1 FROM device_clusters cq WHERE cq.id = d.cluster_id AND host(cq.mgmt_ip) LIKE @q || '%'))
  AND (COALESCE(cardinality(@cluster_ids::uuid[]), 0) = 0 OR d.cluster_id = ANY (@cluster_ids::uuid[]))
  AND (sqlc.narg('category_filter')::uuid IS NULL
       OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
  AND (COALESCE(cardinality(@site_ids::uuid[]), 0) = 0 OR d.site_id = ANY (@site_ids::uuid[]))
  AND (COALESCE(cardinality(@types::text[]), 0) = 0 OR d.type = ANY (@types::text[]))
  AND (COALESCE(cardinality(@vendors::text[]), 0) = 0 OR d.vendor = ANY (@vendors::text[]))
  AND (COALESCE(cardinality(@lifecycles::text[]), 0) = 0 OR d.lifecycle = ANY (@lifecycles::text[]))
  AND (COALESCE(cardinality(@tags::text[]), 0) = 0 OR d.tags && @tags::text[])
GROUP BY 2
UNION ALL
SELECT 'tag'::text AS facet, t.tag AS value, count(*)::bigint AS n
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
CROSS JOIN LATERAL unnest(d.tags) AS t(tag)
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%')
       OR EXISTS (SELECT 1 FROM interfaces ifq WHERE ifq.device_id = d.id AND ifq.mac::text LIKE lower(@q) || '%')
       OR EXISTS (SELECT 1 FROM device_clusters cq WHERE cq.id = d.cluster_id AND host(cq.mgmt_ip) LIKE @q || '%'))
  AND (COALESCE(cardinality(@cluster_ids::uuid[]), 0) = 0 OR d.cluster_id = ANY (@cluster_ids::uuid[]))
  AND (sqlc.narg('category_filter')::uuid IS NULL
       OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
  AND (COALESCE(cardinality(@site_ids::uuid[]), 0) = 0 OR d.site_id = ANY (@site_ids::uuid[]))
  AND (COALESCE(cardinality(@types::text[]), 0) = 0 OR d.type = ANY (@types::text[]))
  AND (COALESCE(cardinality(@vendors::text[]), 0) = 0 OR d.vendor = ANY (@vendors::text[]))
  AND (COALESCE(cardinality(@lifecycles::text[]), 0) = 0 OR d.lifecycle = ANY (@lifecycles::text[]))
  AND (COALESCE(cardinality(@roles::text[]), 0) = 0 OR d.role = ANY (@roles::text[]))
GROUP BY 2
UNION ALL
SELECT 'cluster'::text AS facet, d.cluster_id::text AS value, count(*)::bigint AS n
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%')
       OR EXISTS (SELECT 1 FROM interfaces ifq WHERE ifq.device_id = d.id AND ifq.mac::text LIKE lower(@q) || '%')
       OR EXISTS (SELECT 1 FROM device_clusters cq WHERE cq.id = d.cluster_id AND host(cq.mgmt_ip) LIKE @q || '%'))
  AND (sqlc.narg('category_filter')::uuid IS NULL
       OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
  AND (COALESCE(cardinality(@site_ids::uuid[]), 0) = 0 OR d.site_id = ANY (@site_ids::uuid[]))
  AND (COALESCE(cardinality(@types::text[]), 0) = 0 OR d.type = ANY (@types::text[]))
  AND (COALESCE(cardinality(@vendors::text[]), 0) = 0 OR d.vendor = ANY (@vendors::text[]))
  AND (COALESCE(cardinality(@lifecycles::text[]), 0) = 0 OR d.lifecycle = ANY (@lifecycles::text[]))
  AND (COALESCE(cardinality(@roles::text[]), 0) = 0 OR d.role = ANY (@roles::text[]))
  AND (COALESCE(cardinality(@tags::text[]), 0) = 0 OR d.tags && @tags::text[])
  AND d.cluster_id IS NOT NULL
GROUP BY 2;

-- name: GetDevice :one
SELECT d.*, s.code::text AS site_code, s.name AS site_name, s.category_id,
       category_path(s.category_id)::text AS category_path,
       COALESCE(l.name, '')::text AS location_name, COALESCE(r.name, '')::text AS rack_name,
       COALESCE(mi.name, '')::text AS mgmt_interface_name,
       COALESCE(dc.name, '')::text AS cluster_name, COALESCE(dc.kind, '')::text AS cluster_kind,
       COALESCE((SELECT ip.address::text FROM ip_addresses ip
                 WHERE ip.interface_id = d.mgmt_interface_id AND ip.role = 'primary'
                 ORDER BY family(ip.address) LIMIT 1), dc.mgmt_ip::text, '')::text AS mgmt_ip
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
LEFT JOIN locations l ON l.id = d.location_id
LEFT JOIN racks r ON r.id = d.rack_id
LEFT JOIN interfaces mi ON mi.id = d.mgmt_interface_id
LEFT JOIN device_clusters dc ON dc.id = d.cluster_id
WHERE d.id = @id AND d.organization_id = @organization_id AND d.deleted_at IS NULL;

-- name: CreateDevice :one
INSERT INTO devices (organization_id, site_id, location_id, rack_id, rack_u, u_height, hostname, type,
                     vendor, model, part_number, serial_number, asset_tag, firmware, role, lifecycle, managed, owner_name,
                     purchase_date, po_number, warranty_end, license_end, eol_date, eos_date, notes, tags, custom_fields,
                     template_id, catalog_id, poll_address, cluster_id, cluster_role, cluster_member_no)
VALUES (@organization_id, @site_id, sqlc.narg('location_id'), sqlc.narg('rack_id'), sqlc.narg('rack_u'),
        @u_height, @hostname, @type, @vendor, @model, @part_number, @serial_number, @asset_tag, @firmware, @role, @lifecycle,
        @managed, @owner_name, sqlc.narg('purchase_date'), @po_number, sqlc.narg('warranty_end'), sqlc.narg('license_end'),
        sqlc.narg('eol_date'), sqlc.narg('eos_date'), @notes, @tags, @custom_fields, sqlc.narg('template_id'),
        @catalog_id, sqlc.narg('poll_address'), sqlc.narg('cluster_id'), sqlc.narg('cluster_role'), sqlc.narg('cluster_member_no'))
RETURNING id;

-- name: UpdateDevice :execrows
UPDATE devices SET site_id = @site_id, location_id = sqlc.narg('location_id'),
  rack_id = sqlc.narg('rack_id'), rack_u = sqlc.narg('rack_u'), u_height = @u_height, hostname = @hostname, type = @type,
  vendor = @vendor, model = @model, part_number = @part_number, serial_number = @serial_number, asset_tag = @asset_tag,
  firmware = @firmware, role = @role, lifecycle = @lifecycle, managed = @managed, owner_name = @owner_name,
  purchase_date = sqlc.narg('purchase_date'), po_number = @po_number, warranty_end = sqlc.narg('warranty_end'),
  license_end = sqlc.narg('license_end'), eol_date = sqlc.narg('eol_date'), eos_date = sqlc.narg('eos_date'),
  notes = @notes, tags = @tags, custom_fields = @custom_fields, mgmt_interface_id = sqlc.narg('mgmt_interface_id'),
  poll_address = sqlc.narg('poll_address'), cluster_id = sqlc.narg('cluster_id'), cluster_role = sqlc.narg('cluster_role'),
  cluster_member_no = sqlc.narg('cluster_member_no'), version = version + 1
WHERE id = @id AND organization_id = @organization_id AND deleted_at IS NULL AND version = @version;

-- name: SoftDeleteDevice :execrows
UPDATE devices SET deleted_at = now(), version = version + 1
WHERE id = @id AND organization_id = @organization_id AND deleted_at IS NULL;

-- name: CountLiveDevicesInRack :one
SELECT count(*) FROM devices WHERE organization_id = @organization_id AND rack_id = @rack_id AND deleted_at IS NULL;

-- name: CountLiveDevicesInLocation :one
SELECT count(*) FROM devices WHERE organization_id = @organization_id AND location_id = @location_id AND deleted_at IS NULL;

-- name: CountLiveDevicesInSite :one
SELECT count(*) FROM devices WHERE organization_id = @organization_id AND site_id = @site_id AND deleted_at IS NULL;

-- name: RackOccupancy :many
-- Live devices placed in a rack (for U overlap checks and the rack view).
SELECT id, hostname, rack_u, u_height FROM devices
WHERE organization_id = @organization_id AND rack_id = @rack_id AND deleted_at IS NULL AND rack_u IS NOT NULL
ORDER BY rack_u DESC;

-- name: ListDeviceHistory :many
-- Audit entries of one device, newest first (the detail page "Lịch sử thay đổi" tab).
SELECT a.id, a.created_at, a.action, a.before, a.after, COALESCE(u.email::text, '')::text AS actor_email,
       COALESCE(u.display_name, '')::text AS actor_name
FROM audit_log a
LEFT JOIN users u ON u.id = a.actor_user_id
WHERE a.organization_id = @organization_id AND a.object_type = 'device' AND a.object_id = @device_id::text
ORDER BY a.created_at DESC, a.id DESC
LIMIT 200;

-- name: ListCustomFieldDefs :many
SELECT * FROM custom_field_defs WHERE organization_id = @organization_id ORDER BY sort_order, lower(label);

-- name: CreateCustomFieldDef :one
INSERT INTO custom_field_defs (organization_id, key, label, kind, options, required, sort_order)
VALUES (@organization_id, @key, @label, @kind, @options, @required, @sort_order)
RETURNING *;

-- name: UpdateCustomFieldDef :one
UPDATE custom_field_defs SET label = @label, options = @options, required = @required, sort_order = @sort_order,
  version = version + 1
WHERE id = @id AND organization_id = @organization_id AND version = @version
RETURNING *;

-- name: GetCustomFieldDef :one
SELECT * FROM custom_field_defs WHERE id = @id AND organization_id = @organization_id;

-- name: DeleteCustomFieldDef :execrows
DELETE FROM custom_field_defs WHERE id = @id AND organization_id = @organization_id;

-- name: TouchDevice :exec
-- Interface / IP changes bump the device version so open device forms see the change.
UPDATE devices SET version = version + 1 WHERE id = @id AND organization_id = @organization_id;

-- name: LockHostname :exec
-- Serializes writes of one hostname (key "<org>/<lower hostname>"): the uniqueness rule below cannot be an index (ADR-027).
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(lock_key)::text, 0));

-- name: CountHostnameConflicts :one
-- Live devices with the same hostname, other than the device itself and other members of its cluster.
SELECT count(*) FROM devices
WHERE organization_id = @organization_id AND deleted_at IS NULL AND lower(hostname) = lower(@hostname::text)
  AND (sqlc.narg('self_id')::uuid IS NULL OR id <> sqlc.narg('self_id')::uuid)
  AND (sqlc.narg('cluster_id')::uuid IS NULL OR cluster_id IS NULL OR cluster_id <> sqlc.narg('cluster_id')::uuid);

-- name: ListDevicesByIDs :many
-- Devices placed on a diagram, with the same visibility as GetDevice.
SELECT d.*, s.code::text AS site_code, s.name AS site_name, s.category_id,
       category_path(s.category_id)::text AS category_path,
       COALESCE(l.name, '')::text AS location_name, COALESCE(r.name, '')::text AS rack_name,
       COALESCE(mi.name, '')::text AS mgmt_interface_name,
       COALESCE(dc.name, '')::text AS cluster_name, COALESCE(dc.kind, '')::text AS cluster_kind,
       COALESCE((SELECT ip.address::text FROM ip_addresses ip
                 WHERE ip.interface_id = d.mgmt_interface_id AND ip.role = 'primary'
                 ORDER BY family(ip.address) LIMIT 1), dc.mgmt_ip::text, '')::text AS mgmt_ip
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
LEFT JOIN locations l ON l.id = d.location_id
LEFT JOIN racks r ON r.id = d.rack_id
LEFT JOIN interfaces mi ON mi.id = d.mgmt_interface_id
LEFT JOIN device_clusters dc ON dc.id = d.cluster_id
WHERE d.id = ANY (@ids::uuid[]) AND d.organization_id = @organization_id AND d.deleted_at IS NULL;

-- name: DeviceDeleteImpact :many
-- What deleting devices takes along (ADR-033): cluster left behind and IPs released, per device.
SELECT d.id, d.hostname, COALESCE(s.code, '')::text AS site_code, COALESCE(c.name, '')::text AS cluster_name,
       (SELECT count(*) FROM devices m
        WHERE m.organization_id = d.organization_id AND m.cluster_id = d.cluster_id AND m.deleted_at IS NULL
          AND NOT (m.id = ANY (@ids::uuid[])))::int AS cluster_members_left,
       (SELECT count(*) FROM ip_addresses ip WHERE ip.organization_id = d.organization_id AND ip.device_id = d.id)::int AS ip_count
FROM devices d
LEFT JOIN sites s ON s.id = d.site_id
LEFT JOIN device_clusters c ON c.id = d.cluster_id
WHERE d.organization_id = @organization_id AND d.id = ANY (@ids::uuid[]) AND d.deleted_at IS NULL
ORDER BY d.hostname;
