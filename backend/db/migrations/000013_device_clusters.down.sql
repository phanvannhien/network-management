DROP INDEX devices_org_hostname_idx;
-- Fails if clustered devices share a hostname: rename them before going down.
CREATE UNIQUE INDEX devices_org_hostname_live_idx ON devices (organization_id, lower(hostname)) WHERE deleted_at IS NULL;
DROP INDEX devices_cluster_idx;
DROP INDEX devices_cluster_member_no_idx;
ALTER TABLE devices DROP CONSTRAINT devices_cluster_fields_check, DROP CONSTRAINT devices_cluster_fkey,
  DROP COLUMN cluster_member_no, DROP COLUMN cluster_role, DROP COLUMN cluster_id;
DROP TABLE device_clusters;
