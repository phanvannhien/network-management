-- Device clusters (P1-09b, ADR-027). Every query takes organization_id.

-- name: ListClusters :many
SELECT c.*, s.code::text AS site_code, s.name AS site_name, s.category_id, category_path(s.category_id)::text AS category_path,
       (SELECT count(*) FROM devices m WHERE m.cluster_id = c.id AND m.deleted_at IS NULL)::bigint AS member_count,
       COALESCE((SELECT string_agg(m.hostname, ', ' ORDER BY m.cluster_member_no NULLS LAST, m.hostname)
                 FROM devices m WHERE m.cluster_id = c.id AND m.deleted_at IS NULL), '')::text AS member_hostnames,
       COALESCE((SELECT min(m.type) FROM devices m WHERE m.cluster_id = c.id AND m.deleted_at IS NULL), '')::text
         AS member_type
FROM device_clusters c
JOIN sites s ON s.id = c.site_id AND s.deleted_at IS NULL
WHERE c.organization_id = @organization_id
  AND (sqlc.narg('site_filter')::uuid IS NULL OR c.site_id = sqlc.narg('site_filter'))
ORDER BY lower(c.name);

-- name: GetCluster :one
SELECT c.*, s.code::text AS site_code, s.name AS site_name, s.category_id, category_path(s.category_id)::text AS category_path,
       (SELECT count(*) FROM devices m WHERE m.cluster_id = c.id AND m.deleted_at IS NULL)::bigint AS member_count,
       COALESCE((SELECT string_agg(m.hostname, ', ' ORDER BY m.cluster_member_no NULLS LAST, m.hostname)
                 FROM devices m WHERE m.cluster_id = c.id AND m.deleted_at IS NULL), '')::text AS member_hostnames,
       COALESCE((SELECT min(m.type) FROM devices m WHERE m.cluster_id = c.id AND m.deleted_at IS NULL), '')::text
         AS member_type
FROM device_clusters c
JOIN sites s ON s.id = c.site_id AND s.deleted_at IS NULL
WHERE c.id = @id AND c.organization_id = @organization_id;

-- name: CreateCluster :one
INSERT INTO device_clusters (organization_id, site_id, kind, name, hostname, mgmt_ip, notes)
VALUES (@organization_id, @site_id, @kind, @name, @hostname, sqlc.narg('mgmt_ip'), @notes)
RETURNING id;

-- name: UpdateCluster :execrows
UPDATE device_clusters SET site_id = @site_id, kind = @kind, name = @name,
  hostname = @hostname, mgmt_ip = sqlc.narg('mgmt_ip'), notes = @notes, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND version = @version;

-- name: DeleteCluster :execrows
DELETE FROM device_clusters WHERE id = @id AND organization_id = @organization_id;

-- name: ListClusterMembers :many
SELECT id, hostname, type, model, serial_number, cluster_role, cluster_member_no, lifecycle
FROM devices
WHERE organization_id = @organization_id AND cluster_id = @cluster_id AND deleted_at IS NULL
ORDER BY cluster_member_no NULLS LAST, hostname;
