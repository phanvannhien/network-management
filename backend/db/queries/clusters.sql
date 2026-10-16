-- Device clusters (P1-09b, ADR-027). Every query takes organization_id; visibility follows devices (ADR-031):
-- the cluster's unit is granted, or its site is visible.

-- name: ListClusters :many
SELECT c.*, s.code AS site_code, s.name AS site_name, s.business_unit_id AS site_unit_id, sb.partner_id AS site_partner_id,
       cu.code AS unit_code, cu.name AS unit_name, cu.partner_id, cp.code AS partner_code,
       (SELECT count(*) FROM devices m WHERE m.cluster_id = c.id AND m.deleted_at IS NULL)::bigint AS member_count,
       COALESCE((SELECT string_agg(m.hostname, ', ' ORDER BY m.cluster_member_no NULLS LAST, m.hostname)
                 FROM devices m WHERE m.cluster_id = c.id AND m.deleted_at IS NULL), '')::text AS member_hostnames
FROM device_clusters c
JOIN sites s ON s.id = c.site_id AND s.deleted_at IS NULL
JOIN business_units cu ON cu.id = c.business_unit_id
JOIN partners cp ON cp.id = cu.partner_id
LEFT JOIN business_units sb ON sb.id = s.business_unit_id
WHERE c.organization_id = @organization_id
  AND (sqlc.narg('site_filter')::uuid IS NULL OR c.site_id = sqlc.narg('site_filter'))
  AND (NOT @restricted::boolean
       OR c.business_unit_id = ANY (@grant_units::uuid[]) OR cu.partner_id = ANY (@grant_partners::uuid[])
       OR sb.id = ANY (@grant_units::uuid[]) OR sb.partner_id = ANY (@grant_partners::uuid[])
       OR EXISTS (SELECT 1 FROM resource_shares rs
                  LEFT JOIN business_units tu ON tu.id = rs.target_unit_id AND tu.deleted_at IS NULL
                  WHERE rs.organization_id = s.organization_id AND rs.resource_type = 'site' AND rs.resource_id = s.id
                    AND (rs.target_partner_id = ANY (@share_partners::uuid[])
                         OR rs.target_unit_id = ANY (@grant_units::uuid[])
                         OR tu.partner_id = ANY (@grant_partners::uuid[]))))
ORDER BY lower(c.name);

-- name: GetCluster :one
SELECT c.*, s.code AS site_code, s.name AS site_name, s.business_unit_id AS site_unit_id, sb.partner_id AS site_partner_id,
       cu.code AS unit_code, cu.name AS unit_name, cu.partner_id, cp.code AS partner_code,
       (SELECT count(*) FROM devices m WHERE m.cluster_id = c.id AND m.deleted_at IS NULL)::bigint AS member_count,
       COALESCE((SELECT string_agg(m.hostname, ', ' ORDER BY m.cluster_member_no NULLS LAST, m.hostname)
                 FROM devices m WHERE m.cluster_id = c.id AND m.deleted_at IS NULL), '')::text AS member_hostnames
FROM device_clusters c
JOIN sites s ON s.id = c.site_id AND s.deleted_at IS NULL
JOIN business_units cu ON cu.id = c.business_unit_id
JOIN partners cp ON cp.id = cu.partner_id
LEFT JOIN business_units sb ON sb.id = s.business_unit_id
WHERE c.id = @id AND c.organization_id = @organization_id
  AND (NOT @restricted::boolean
       OR c.business_unit_id = ANY (@grant_units::uuid[]) OR cu.partner_id = ANY (@grant_partners::uuid[])
       OR sb.id = ANY (@grant_units::uuid[]) OR sb.partner_id = ANY (@grant_partners::uuid[])
       OR EXISTS (SELECT 1 FROM resource_shares rs
                  LEFT JOIN business_units tu ON tu.id = rs.target_unit_id AND tu.deleted_at IS NULL
                  WHERE rs.organization_id = s.organization_id AND rs.resource_type = 'site' AND rs.resource_id = s.id
                    AND (rs.target_partner_id = ANY (@share_partners::uuid[])
                         OR rs.target_unit_id = ANY (@grant_units::uuid[])
                         OR tu.partner_id = ANY (@grant_partners::uuid[]))));

-- name: CreateCluster :one
INSERT INTO device_clusters (organization_id, business_unit_id, site_id, kind, name, hostname, mgmt_ip, notes)
VALUES (@organization_id, @business_unit_id, @site_id, @kind, @name, @hostname, sqlc.narg('mgmt_ip'), @notes)
RETURNING id;

-- name: UpdateCluster :execrows
UPDATE device_clusters SET business_unit_id = @business_unit_id, site_id = @site_id, kind = @kind, name = @name,
  hostname = @hostname, mgmt_ip = sqlc.narg('mgmt_ip'), notes = @notes, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND version = @version;

-- name: DeleteCluster :execrows
DELETE FROM device_clusters WHERE id = @id AND organization_id = @organization_id;

-- name: ListClusterMembers :many
SELECT id, hostname, type, model, serial_number, cluster_role, cluster_member_no, lifecycle
FROM devices
WHERE organization_id = @organization_id AND cluster_id = @cluster_id AND deleted_at IS NULL
ORDER BY cluster_member_no NULLS LAST, hostname;
