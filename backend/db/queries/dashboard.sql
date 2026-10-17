-- Dashboard (P1-24, SRS §2, DESIGN.md §7c): figures and org-wide problems. Every query takes organization_id and the
-- topbar category (NULL = whole organization; a category includes its subtree, ADR-032).

-- name: DashboardBySite :many
SELECT s.id, s.code::text AS code, s.name,
       count(d.id) FILTER (WHERE d.lifecycle <> 'retired')::bigint AS total,
       count(d.id) FILTER (WHERE d.lifecycle = 'active')::bigint AS active,
       count(d.id) FILTER (WHERE d.lifecycle = 'planned')::bigint AS planned,
       count(d.id) FILTER (WHERE d.lifecycle = 'spare')::bigint AS spare,
       count(d.id) FILTER (WHERE d.lifecycle = 'rma')::bigint AS rma,
       count(d.id) FILTER (WHERE d.lifecycle = 'retired')::bigint AS retired
FROM sites s
LEFT JOIN devices d ON d.site_id = s.id AND d.organization_id = s.organization_id AND d.deleted_at IS NULL
WHERE s.organization_id = @organization_id AND s.deleted_at IS NULL
  AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
GROUP BY s.id, s.code, s.name
ORDER BY count(d.id) FILTER (WHERE d.lifecycle <> 'retired') DESC, s.code;

-- name: DashboardByType :many
SELECT d.type, count(*)::bigint AS total
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL AND d.lifecycle <> 'retired'
  AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
GROUP BY d.type
ORDER BY count(*) DESC, d.type;

-- name: DashboardMissingInfo :many
-- Active devices lacking S/N, part number, model or location (SRS §7, Info). Location only counts where the site has
-- locations; provider clouds, passive kit, ISP boxes and end-user devices are not asked. total = all such devices;
-- rows = the first @lim.
WITH m AS (
  SELECT d.id, d.hostname, s.code::text AS site_code,
         (btrim(d.serial_number) = '') AS no_serial, (btrim(d.part_number) = '') AS no_part,
         (btrim(d.model) = '') AS no_model,
         (d.location_id IS NULL AND EXISTS (SELECT 1 FROM locations l WHERE l.site_id = s.id)) AS no_location
  FROM devices d
  JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
  WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL AND d.lifecycle = 'active'
    AND d.type NOT IN ('provider_cloud', 'patch_panel', 'media_converter', 'modem', 'ont', 'vm', 'pc', 'laptop', 'ip_phone', 'iot', 'other')
    AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
)
SELECT id, hostname, site_code, no_serial::boolean AS no_serial, no_part::boolean AS no_part,
       no_model::boolean AS no_model, no_location::boolean AS no_location, count(*) OVER ()::bigint AS total
FROM m
WHERE no_serial OR no_part OR no_model OR no_location
ORDER BY site_code, lower(hostname)
LIMIT @lim;

-- name: DashboardExpiring :many
-- Warranty / end-of-support dates for devices still in use: those from @today to @until first (soonest first), then
-- those already past (latest first). total / overdue count every such date, rows are the first 50.
WITH dates AS (
  SELECT d.id, 'warranty' AS kind, d.warranty_end AS day FROM devices d
  WHERE d.organization_id = @organization_id AND d.warranty_end IS NOT NULL
  UNION ALL
  SELECT d.id, 'eos', d.eos_date FROM devices d
  WHERE d.organization_id = @organization_id AND d.eos_date IS NOT NULL
), e AS (
  SELECT d.id, d.hostname, s.code::text AS site_code, dates.kind::text AS kind, dates.day::date AS day
  FROM dates
  JOIN devices d ON d.id = dates.id
  JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
  WHERE d.deleted_at IS NULL AND d.lifecycle <> 'retired' AND dates.day <= @until::date
    AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
)
SELECT id, hostname, site_code, kind, day,
       count(*) OVER ()::bigint AS total, count(*) FILTER (WHERE day < @today::date) OVER ()::bigint AS overdue
FROM e
ORDER BY (day < @today::date), CASE WHEN day >= @today::date THEN day END, day DESC, lower(hostname)
LIMIT 50;

-- name: DashboardDuplicateIps :many
-- Addresses held by more than one owner in a VRF (same rules as the diagram check DuplicateIps: a cluster and its VIP
-- are one owner, retired devices and IPv6 link-local do not count). error when two holders are interface addresses of
-- active devices, else warning. With a category: conflicts touching it (the other copy may be outside).
WITH holders AS (
  SELECT ip.vrf, host(ip.address)::inet AS h, ip.role, COALESCE(d.cluster_id, d.id) AS owner, d.hostname AS name,
         d.lifecycle, s.category_id
  FROM ip_addresses ip
  JOIN devices d ON d.id = ip.device_id AND d.deleted_at IS NULL AND d.lifecycle <> 'retired'
  JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
  WHERE ip.organization_id = @organization_id AND NOT ip.address << 'fe80::/10'::inet
  UNION ALL
  SELECT '', host(c.mgmt_ip)::inet, 'primary', c.id, COALESCE(NULLIF(c.hostname, ''), c.name), 'active', s.category_id
  FROM device_clusters c
  JOIN sites s ON s.id = c.site_id AND s.deleted_at IS NULL
  WHERE c.organization_id = @organization_id AND c.mgmt_ip IS NOT NULL
  UNION ALL
  SELECT COALESCE(sn.vrf, ''), em.ip, 'primary', em.id, em.name, 'active', s.category_id
  FROM endpoint_members em
  JOIN endpoint_groups g ON g.id = em.group_id
  JOIN sites s ON s.id = g.site_id AND s.deleted_at IS NULL
  LEFT JOIN ip_ranges r ON r.id = g.ip_range_id
  LEFT JOIN subnets sn ON sn.id = r.subnet_id
  WHERE em.organization_id = @organization_id AND em.ip IS NOT NULL
), scope AS (
  SELECT category_subtree(sqlc.narg('category_filter')::uuid) AS id
)
SELECT host(h)::text AS address, vrf::text AS vrf,
       array_agg(DISTINCT name ORDER BY name)::text[] AS holders, count(DISTINCT owner)::bigint AS owners,
       (CASE WHEN count(DISTINCT owner) FILTER (WHERE role IN ('primary', 'secondary') AND lifecycle = 'active') > 1
             THEN 'error' ELSE 'warning' END)::text AS severity
FROM holders
GROUP BY vrf, h
HAVING count(DISTINCT owner) > 1
   AND (sqlc.narg('category_filter')::uuid IS NULL OR bool_or(category_id IN (SELECT id FROM scope)))
ORDER BY h
LIMIT 100;

-- name: DashboardDuplicateHostnames :many
-- Live hostnames used by more than one device outside one cluster (provider clouds excepted, ADR-027 / ADR-033).
SELECT min(d.hostname)::text AS hostname, count(*)::bigint AS total
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL AND d.type <> 'provider_cloud'
  AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
GROUP BY lower(d.hostname)
HAVING count(DISTINCT COALESCE(d.cluster_id, d.id)) > 1
ORDER BY lower(d.hostname)
LIMIT 100;

-- name: DashboardDuplicateSerials :many
SELECT min(d.serial_number)::text AS serial, array_agg(d.hostname ORDER BY d.hostname)::text[] AS hostnames
FROM devices d
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL AND d.lifecycle <> 'retired'
  AND lower(btrim(d.serial_number)) NOT IN ('', '-', 'n/a', 'na', 'none', 'unknown', 'tbd', '0')
  AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
GROUP BY lower(btrim(d.serial_number))
HAVING count(*) > 1
ORDER BY 1
LIMIT 100;

-- name: DashboardPortsMultiLink :many
-- Physical ports with more than one cable of a kind that occupies the port (link rules; a PON port feeds a splitter).
SELECT d.id AS device_id, d.hostname, i.name AS interface_name, count(*)::bigint AS links
FROM interfaces i
JOIN devices d ON d.id = i.device_id AND d.deleted_at IS NULL
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
JOIN links l ON l.organization_id = i.organization_id AND (l.a_interface_id = i.id OR l.b_interface_id = i.id)
  AND l.kind IN ('ethernet', 'fiber', 'serial', 'console', 'power', 'stack', 'dsl')
WHERE i.organization_id = @organization_id AND i.kind = 'physical' AND i.media <> 'PON'
  AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
GROUP BY d.id, d.hostname, i.name
HAVING count(*) > 1
ORDER BY lower(d.hostname), i.name
LIMIT 100;

-- name: DashboardCounts :one
-- Info-level counts: active devices without any cable; devices with an address but no management interface chosen.
SELECT
  (SELECT count(*) FROM devices d JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
    WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL AND d.lifecycle = 'active'
      AND d.type NOT IN ('provider_cloud', 'vm', 'patch_panel', 'ups', 'pdu', 'media_converter')
      AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
      AND NOT EXISTS (SELECT 1 FROM links l WHERE l.organization_id = d.organization_id
                        AND ((l.a_kind = 'device' AND l.a_id = d.id) OR (l.b_kind = 'device' AND l.b_id = d.id))))::bigint AS no_link,
  (SELECT count(*) FROM devices d JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
    WHERE d.organization_id = @organization_id AND d.deleted_at IS NULL AND d.lifecycle <> 'retired'
      AND d.mgmt_interface_id IS NULL AND d.cluster_id IS NULL
      AND (sqlc.narg('category_filter')::uuid IS NULL OR s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid)))
      AND EXISTS (SELECT 1 FROM ip_addresses ip WHERE ip.device_id = d.id AND ip.interface_id IS NOT NULL))::bigint AS no_mgmt;

-- name: DashboardSubnets :many
-- IPv4 subnets with the addresses taken: documented hosts outside DHCP / reserved pools, plus those pools whole (a
-- DHCP pool hands its addresses out, they are not free). The API keeps those ≥ 90 % full.
WITH sn AS (
  SELECT sn.id, sn.cidr, sn.vrf, sn.organization_id
  FROM subnets sn
  LEFT JOIN sites s ON s.id = sn.site_id AND s.deleted_at IS NULL
  WHERE sn.organization_id = @organization_id AND family(sn.cidr) = 4 AND masklen(sn.cidr) <= 29
    AND (sn.site_id IS NULL OR s.id IS NOT NULL)
    AND (sqlc.narg('category_filter')::uuid IS NULL
         OR (sn.site_id IS NOT NULL AND s.category_id IN (SELECT category_subtree(sqlc.narg('category_filter')::uuid))))
), pools AS (
  SELECT r.subnet_id, r.start_ip, r.end_ip
  FROM ip_ranges r JOIN sn ON sn.id = r.subnet_id
  WHERE r.kind IN ('dhcp', 'reserved')
), hosts AS (
  SELECT sn.id AS subnet_id, count(DISTINCT a.host) AS n
  FROM sn
  JOIN ipam_addresses a ON a.organization_id = sn.organization_id AND a.vrf = sn.vrf AND a.host << sn.cidr
  WHERE NOT EXISTS (SELECT 1 FROM pools p WHERE p.subnet_id = sn.id AND a.host BETWEEN p.start_ip AND p.end_ip)
  GROUP BY sn.id
), pooled AS (
  SELECT subnet_id, sum(end_ip - start_ip + 1) AS n FROM pools GROUP BY subnet_id
)
SELECT sn.id, sn.cidr::text AS cidr, sn.vrf, masklen(sn.cidr)::int AS bits,
       (COALESCE(h.n, 0) + COALESCE(p.n, 0))::bigint AS used
FROM sn
LEFT JOIN hosts h ON h.subnet_id = sn.id
LEFT JOIN pooled p ON p.subnet_id = sn.id;
