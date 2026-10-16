-- Devices (P1-08, SRS §4.1). Every query takes organization_id; restricted callers (role member, ADR-031)
-- see devices of their granted units plus every device in a site visible to them.

-- name: ListDevices :many
SELECT d.*, s.code AS site_code, s.name AS site_name, s.business_unit_id AS site_unit_id, sb.partner_id AS site_partner_id,
       du.code AS unit_code, du.name AS unit_name, du.partner_id, dp.code AS partner_code, dp.name AS partner_name,
       COALESCE(l.name, '')::text AS location_name, COALESCE(r.name, '')::text AS rack_name,
       COALESCE(mi.name, '')::text AS mgmt_interface_name,
       COALESCE(dc.name, '')::text AS cluster_name, COALESCE(dc.kind, '')::text AS cluster_kind,
       COALESCE((SELECT ip.address::text FROM ip_addresses ip
                 WHERE ip.interface_id = d.mgmt_interface_id AND ip.role = 'primary'
                 ORDER BY family(ip.address) LIMIT 1), '')::text AS mgmt_ip
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
JOIN business_units du ON du.id = d.business_unit_id
JOIN partners dp ON dp.id = du.partner_id
LEFT JOIN business_units sb ON sb.id = s.business_unit_id
LEFT JOIN locations l ON l.id = d.location_id
LEFT JOIN racks r ON r.id = d.rack_id
LEFT JOIN interfaces mi ON mi.id = d.mgmt_interface_id
LEFT JOIN device_clusters dc ON dc.id = d.cluster_id
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  -- Visibility (ADR-031): the device's unit is granted (directly or via its partner), or its site is visible
  -- to the caller (site's unit granted, or the site shared to the caller).
  AND (NOT @restricted::boolean
       OR d.business_unit_id = ANY (@grant_units::uuid[]) OR du.partner_id = ANY (@grant_partners::uuid[])
       OR sb.id = ANY (@grant_units::uuid[]) OR sb.partner_id = ANY (@grant_partners::uuid[])
       OR EXISTS (SELECT 1 FROM resource_shares rs
                  LEFT JOIN business_units tu ON tu.id = rs.target_unit_id AND tu.deleted_at IS NULL
                  WHERE rs.organization_id = s.organization_id AND rs.resource_type = 'site' AND rs.resource_id = s.id
                    AND (rs.target_partner_id = ANY (@share_partners::uuid[])
                         OR rs.target_unit_id = ANY (@grant_units::uuid[])
                         OR tu.partner_id = ANY (@grant_partners::uuid[]))))
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%'))
  AND (sqlc.narg('partner_filter')::uuid IS NULL OR du.partner_id = sqlc.narg('partner_filter'))
  AND (sqlc.narg('unit_filter')::uuid IS NULL OR d.business_unit_id = sqlc.narg('unit_filter'))
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
      WHEN 'unit' THEN dp.code || '/' || du.code ELSE NULL END END ASC NULLS LAST,
  CASE WHEN @sort_desc::boolean THEN
    CASE @sort_key::text WHEN 'type' THEN d.type WHEN 'vendor' THEN lower(d.vendor) WHEN 'model' THEN lower(d.model)
      WHEN 'site' THEN s.code WHEN 'lifecycle' THEN d.lifecycle WHEN 'serial' THEN lower(d.serial_number)
      WHEN 'unit' THEN dp.code || '/' || du.code ELSE NULL END END DESC NULLS LAST,
  CASE WHEN @sort_key::text = 'warranty_end' AND NOT @sort_desc::boolean THEN d.warranty_end END ASC NULLS LAST,
  CASE WHEN @sort_key::text = 'warranty_end' AND @sort_desc::boolean THEN d.warranty_end END DESC NULLS LAST,
  CASE WHEN @sort_key::text = 'mgmt_ip' AND NOT @sort_desc::boolean THEN
    (SELECT ip.address FROM ip_addresses ip WHERE ip.interface_id = d.mgmt_interface_id AND ip.role = 'primary'
     ORDER BY family(ip.address) LIMIT 1) END ASC NULLS LAST,
  CASE WHEN @sort_key::text = 'mgmt_ip' AND @sort_desc::boolean THEN
    (SELECT ip.address FROM ip_addresses ip WHERE ip.interface_id = d.mgmt_interface_id AND ip.role = 'primary'
     ORDER BY family(ip.address) LIMIT 1) END DESC NULLS LAST,
  CASE WHEN @sort_key::text = 'hostname' AND @sort_desc::boolean THEN lower(d.hostname) END DESC,
  lower(d.hostname), d.id
LIMIT @page_limit OFFSET @page_offset;

-- name: CountDevices :one
SELECT count(*)
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
JOIN business_units du ON du.id = d.business_unit_id
JOIN partners dp ON dp.id = du.partner_id
LEFT JOIN business_units sb ON sb.id = s.business_unit_id
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  -- Visibility (ADR-031): the device's unit is granted (directly or via its partner), or its site is visible
  -- to the caller (site's unit granted, or the site shared to the caller).
  AND (NOT @restricted::boolean
       OR d.business_unit_id = ANY (@grant_units::uuid[]) OR du.partner_id = ANY (@grant_partners::uuid[])
       OR sb.id = ANY (@grant_units::uuid[]) OR sb.partner_id = ANY (@grant_partners::uuid[])
       OR EXISTS (SELECT 1 FROM resource_shares rs
                  LEFT JOIN business_units tu ON tu.id = rs.target_unit_id AND tu.deleted_at IS NULL
                  WHERE rs.organization_id = s.organization_id AND rs.resource_type = 'site' AND rs.resource_id = s.id
                    AND (rs.target_partner_id = ANY (@share_partners::uuid[])
                         OR rs.target_unit_id = ANY (@grant_units::uuid[])
                         OR tu.partner_id = ANY (@grant_partners::uuid[]))))
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%'))
  AND (sqlc.narg('partner_filter')::uuid IS NULL OR du.partner_id = sqlc.narg('partner_filter'))
  AND (sqlc.narg('unit_filter')::uuid IS NULL OR d.business_unit_id = sqlc.narg('unit_filter'))
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
JOIN business_units du ON du.id = d.business_unit_id
JOIN partners dp ON dp.id = du.partner_id
LEFT JOIN business_units sb ON sb.id = s.business_unit_id
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  -- Visibility (ADR-031): the device's unit is granted (directly or via its partner), or its site is visible
  -- to the caller (site's unit granted, or the site shared to the caller).
  AND (NOT @restricted::boolean
       OR d.business_unit_id = ANY (@grant_units::uuid[]) OR du.partner_id = ANY (@grant_partners::uuid[])
       OR sb.id = ANY (@grant_units::uuid[]) OR sb.partner_id = ANY (@grant_partners::uuid[])
       OR EXISTS (SELECT 1 FROM resource_shares rs
                  LEFT JOIN business_units tu ON tu.id = rs.target_unit_id AND tu.deleted_at IS NULL
                  WHERE rs.organization_id = s.organization_id AND rs.resource_type = 'site' AND rs.resource_id = s.id
                    AND (rs.target_partner_id = ANY (@share_partners::uuid[])
                         OR rs.target_unit_id = ANY (@grant_units::uuid[])
                         OR tu.partner_id = ANY (@grant_partners::uuid[]))))
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%'))
  AND (sqlc.narg('partner_filter')::uuid IS NULL OR du.partner_id = sqlc.narg('partner_filter'))
  AND (sqlc.narg('unit_filter')::uuid IS NULL OR d.business_unit_id = sqlc.narg('unit_filter'))
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
JOIN business_units du ON du.id = d.business_unit_id
JOIN partners dp ON dp.id = du.partner_id
LEFT JOIN business_units sb ON sb.id = s.business_unit_id
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  -- Visibility (ADR-031): the device's unit is granted (directly or via its partner), or its site is visible
  -- to the caller (site's unit granted, or the site shared to the caller).
  AND (NOT @restricted::boolean
       OR d.business_unit_id = ANY (@grant_units::uuid[]) OR du.partner_id = ANY (@grant_partners::uuid[])
       OR sb.id = ANY (@grant_units::uuid[]) OR sb.partner_id = ANY (@grant_partners::uuid[])
       OR EXISTS (SELECT 1 FROM resource_shares rs
                  LEFT JOIN business_units tu ON tu.id = rs.target_unit_id AND tu.deleted_at IS NULL
                  WHERE rs.organization_id = s.organization_id AND rs.resource_type = 'site' AND rs.resource_id = s.id
                    AND (rs.target_partner_id = ANY (@share_partners::uuid[])
                         OR rs.target_unit_id = ANY (@grant_units::uuid[])
                         OR tu.partner_id = ANY (@grant_partners::uuid[]))))
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%'))
  AND (sqlc.narg('partner_filter')::uuid IS NULL OR du.partner_id = sqlc.narg('partner_filter'))
  AND (sqlc.narg('unit_filter')::uuid IS NULL OR d.business_unit_id = sqlc.narg('unit_filter'))
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
JOIN business_units du ON du.id = d.business_unit_id
JOIN partners dp ON dp.id = du.partner_id
LEFT JOIN business_units sb ON sb.id = s.business_unit_id
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  -- Visibility (ADR-031): the device's unit is granted (directly or via its partner), or its site is visible
  -- to the caller (site's unit granted, or the site shared to the caller).
  AND (NOT @restricted::boolean
       OR d.business_unit_id = ANY (@grant_units::uuid[]) OR du.partner_id = ANY (@grant_partners::uuid[])
       OR sb.id = ANY (@grant_units::uuid[]) OR sb.partner_id = ANY (@grant_partners::uuid[])
       OR EXISTS (SELECT 1 FROM resource_shares rs
                  LEFT JOIN business_units tu ON tu.id = rs.target_unit_id AND tu.deleted_at IS NULL
                  WHERE rs.organization_id = s.organization_id AND rs.resource_type = 'site' AND rs.resource_id = s.id
                    AND (rs.target_partner_id = ANY (@share_partners::uuid[])
                         OR rs.target_unit_id = ANY (@grant_units::uuid[])
                         OR tu.partner_id = ANY (@grant_partners::uuid[]))))
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%'))
  AND (sqlc.narg('partner_filter')::uuid IS NULL OR du.partner_id = sqlc.narg('partner_filter'))
  AND (sqlc.narg('unit_filter')::uuid IS NULL OR d.business_unit_id = sqlc.narg('unit_filter'))
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
JOIN business_units du ON du.id = d.business_unit_id
JOIN partners dp ON dp.id = du.partner_id
LEFT JOIN business_units sb ON sb.id = s.business_unit_id
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  -- Visibility (ADR-031): the device's unit is granted (directly or via its partner), or its site is visible
  -- to the caller (site's unit granted, or the site shared to the caller).
  AND (NOT @restricted::boolean
       OR d.business_unit_id = ANY (@grant_units::uuid[]) OR du.partner_id = ANY (@grant_partners::uuid[])
       OR sb.id = ANY (@grant_units::uuid[]) OR sb.partner_id = ANY (@grant_partners::uuid[])
       OR EXISTS (SELECT 1 FROM resource_shares rs
                  LEFT JOIN business_units tu ON tu.id = rs.target_unit_id AND tu.deleted_at IS NULL
                  WHERE rs.organization_id = s.organization_id AND rs.resource_type = 'site' AND rs.resource_id = s.id
                    AND (rs.target_partner_id = ANY (@share_partners::uuid[])
                         OR rs.target_unit_id = ANY (@grant_units::uuid[])
                         OR tu.partner_id = ANY (@grant_partners::uuid[]))))
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%'))
  AND (sqlc.narg('partner_filter')::uuid IS NULL OR du.partner_id = sqlc.narg('partner_filter'))
  AND (sqlc.narg('unit_filter')::uuid IS NULL OR d.business_unit_id = sqlc.narg('unit_filter'))
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
JOIN business_units du ON du.id = d.business_unit_id
JOIN partners dp ON dp.id = du.partner_id
LEFT JOIN business_units sb ON sb.id = s.business_unit_id
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  -- Visibility (ADR-031): the device's unit is granted (directly or via its partner), or its site is visible
  -- to the caller (site's unit granted, or the site shared to the caller).
  AND (NOT @restricted::boolean
       OR d.business_unit_id = ANY (@grant_units::uuid[]) OR du.partner_id = ANY (@grant_partners::uuid[])
       OR sb.id = ANY (@grant_units::uuid[]) OR sb.partner_id = ANY (@grant_partners::uuid[])
       OR EXISTS (SELECT 1 FROM resource_shares rs
                  LEFT JOIN business_units tu ON tu.id = rs.target_unit_id AND tu.deleted_at IS NULL
                  WHERE rs.organization_id = s.organization_id AND rs.resource_type = 'site' AND rs.resource_id = s.id
                    AND (rs.target_partner_id = ANY (@share_partners::uuid[])
                         OR rs.target_unit_id = ANY (@grant_units::uuid[])
                         OR tu.partner_id = ANY (@grant_partners::uuid[]))))
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%'))
  AND (sqlc.narg('partner_filter')::uuid IS NULL OR du.partner_id = sqlc.narg('partner_filter'))
  AND (sqlc.narg('unit_filter')::uuid IS NULL OR d.business_unit_id = sqlc.narg('unit_filter'))
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
JOIN business_units du ON du.id = d.business_unit_id
JOIN partners dp ON dp.id = du.partner_id
LEFT JOIN business_units sb ON sb.id = s.business_unit_id
CROSS JOIN LATERAL unnest(d.tags) AS t(tag)
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL
  -- Visibility (ADR-031): the device's unit is granted (directly or via its partner), or its site is visible
  -- to the caller (site's unit granted, or the site shared to the caller).
  AND (NOT @restricted::boolean
       OR d.business_unit_id = ANY (@grant_units::uuid[]) OR du.partner_id = ANY (@grant_partners::uuid[])
       OR sb.id = ANY (@grant_units::uuid[]) OR sb.partner_id = ANY (@grant_partners::uuid[])
       OR EXISTS (SELECT 1 FROM resource_shares rs
                  LEFT JOIN business_units tu ON tu.id = rs.target_unit_id AND tu.deleted_at IS NULL
                  WHERE rs.organization_id = s.organization_id AND rs.resource_type = 'site' AND rs.resource_id = s.id
                    AND (rs.target_partner_id = ANY (@share_partners::uuid[])
                         OR rs.target_unit_id = ANY (@grant_units::uuid[])
                         OR tu.partner_id = ANY (@grant_partners::uuid[]))))
  AND (@q::text = '' OR d.hostname ILIKE '%' || @q || '%' OR d.serial_number ILIKE '%' || @q || '%'
       OR d.part_number ILIKE '%' || @q || '%' OR d.model ILIKE '%' || @q || '%' OR d.asset_tag ILIKE '%' || @q || '%'
       OR EXISTS (SELECT 1 FROM ip_addresses ipq WHERE ipq.device_id = d.id AND host(ipq.address) LIKE @q || '%'))
  AND (sqlc.narg('partner_filter')::uuid IS NULL OR du.partner_id = sqlc.narg('partner_filter'))
  AND (sqlc.narg('unit_filter')::uuid IS NULL OR d.business_unit_id = sqlc.narg('unit_filter'))
  AND (COALESCE(cardinality(@site_ids::uuid[]), 0) = 0 OR d.site_id = ANY (@site_ids::uuid[]))
  AND (COALESCE(cardinality(@types::text[]), 0) = 0 OR d.type = ANY (@types::text[]))
  AND (COALESCE(cardinality(@vendors::text[]), 0) = 0 OR d.vendor = ANY (@vendors::text[]))
  AND (COALESCE(cardinality(@lifecycles::text[]), 0) = 0 OR d.lifecycle = ANY (@lifecycles::text[]))
  AND (COALESCE(cardinality(@roles::text[]), 0) = 0 OR d.role = ANY (@roles::text[]))
GROUP BY 2;

-- name: GetDevice :one
SELECT d.*, s.code AS site_code, s.name AS site_name, s.business_unit_id AS site_unit_id, sb.partner_id AS site_partner_id,
       du.code AS unit_code, du.name AS unit_name, du.partner_id, dp.code AS partner_code, dp.name AS partner_name,
       COALESCE(l.name, '')::text AS location_name, COALESCE(r.name, '')::text AS rack_name,
       COALESCE(mi.name, '')::text AS mgmt_interface_name,
       COALESCE(dc.name, '')::text AS cluster_name, COALESCE(dc.kind, '')::text AS cluster_kind,
       COALESCE((SELECT ip.address::text FROM ip_addresses ip
                 WHERE ip.interface_id = d.mgmt_interface_id AND ip.role = 'primary'
                 ORDER BY family(ip.address) LIMIT 1), '')::text AS mgmt_ip
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
JOIN business_units du ON du.id = d.business_unit_id
JOIN partners dp ON dp.id = du.partner_id
LEFT JOIN business_units sb ON sb.id = s.business_unit_id
LEFT JOIN locations l ON l.id = d.location_id
LEFT JOIN racks r ON r.id = d.rack_id
LEFT JOIN interfaces mi ON mi.id = d.mgmt_interface_id
LEFT JOIN device_clusters dc ON dc.id = d.cluster_id
WHERE d.id = @id AND d.organization_id = @organization_id AND d.deleted_at IS NULL
  -- Visibility (ADR-031): the device's unit is granted (directly or via its partner), or its site is visible
  -- to the caller (site's unit granted, or the site shared to the caller).
  AND (NOT @restricted::boolean
       OR d.business_unit_id = ANY (@grant_units::uuid[]) OR du.partner_id = ANY (@grant_partners::uuid[])
       OR sb.id = ANY (@grant_units::uuid[]) OR sb.partner_id = ANY (@grant_partners::uuid[])
       OR EXISTS (SELECT 1 FROM resource_shares rs
                  LEFT JOIN business_units tu ON tu.id = rs.target_unit_id AND tu.deleted_at IS NULL
                  WHERE rs.organization_id = s.organization_id AND rs.resource_type = 'site' AND rs.resource_id = s.id
                    AND (rs.target_partner_id = ANY (@share_partners::uuid[])
                         OR rs.target_unit_id = ANY (@grant_units::uuid[])
                         OR tu.partner_id = ANY (@grant_partners::uuid[]))));

-- name: CreateDevice :one
INSERT INTO devices (organization_id, business_unit_id, site_id, location_id, rack_id, rack_u, u_height, hostname, type,
                     vendor, model, part_number, serial_number, asset_tag, firmware, role, lifecycle, managed, owner_name,
                     purchase_date, po_number, warranty_end, license_end, eol_date, eos_date, notes, tags, custom_fields,
                     template_id, poll_address, cluster_id, cluster_role, cluster_member_no)
VALUES (@organization_id, @business_unit_id, @site_id, sqlc.narg('location_id'), sqlc.narg('rack_id'), sqlc.narg('rack_u'),
        @u_height, @hostname, @type, @vendor, @model, @part_number, @serial_number, @asset_tag, @firmware, @role, @lifecycle,
        @managed, @owner_name, sqlc.narg('purchase_date'), @po_number, sqlc.narg('warranty_end'), sqlc.narg('license_end'),
        sqlc.narg('eol_date'), sqlc.narg('eos_date'), @notes, @tags, @custom_fields, sqlc.narg('template_id'),
        sqlc.narg('poll_address'), sqlc.narg('cluster_id'), sqlc.narg('cluster_role'), sqlc.narg('cluster_member_no'))
RETURNING id;

-- name: UpdateDevice :execrows
UPDATE devices SET business_unit_id = @business_unit_id, site_id = @site_id, location_id = sqlc.narg('location_id'),
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

-- name: CountLiveDevicesOfUnit :one
SELECT count(*) FROM devices WHERE organization_id = @organization_id AND business_unit_id = @business_unit_id
  AND deleted_at IS NULL;

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
