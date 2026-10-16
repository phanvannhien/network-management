-- P1-09b device clusters (ADR-027): HA pairs, stacks, vPC/VSS. Members keep their own S/N, part number and warranty;
-- the cluster may carry a shared hostname and management IP. Members of one cluster may share a hostname (a stack),
-- so live hostnames are unique per organization *except within a cluster* — checked by the API under a transaction
-- lock, since a unique index cannot express it.

CREATE TABLE device_clusters (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  business_unit_id  uuid NOT NULL,
  site_id           uuid NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('ha_active_passive', 'ha_active_active', 'stack', 'vpc', 'vss', 'other')),
  name              text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 100),
  hostname          text NOT NULL DEFAULT '' CHECK (length(hostname) <= 253),
  mgmt_ip           inet,
  notes             text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),
  FOREIGN KEY (business_unit_id, organization_id) REFERENCES business_units (id, organization_id),
  FOREIGN KEY (site_id, organization_id) REFERENCES sites (id, organization_id)
);
CREATE UNIQUE INDEX device_clusters_org_name_idx ON device_clusters (organization_id, lower(name));
CREATE INDEX device_clusters_site_idx ON device_clusters (organization_id, site_id);
CREATE TRIGGER device_clusters_updated_at BEFORE UPDATE ON device_clusters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE devices
  ADD COLUMN cluster_id uuid,
  ADD COLUMN cluster_role text CHECK (cluster_role IN ('primary', 'secondary', 'member')),
  ADD COLUMN cluster_member_no integer CHECK (cluster_member_no BETWEEN 1 AND 99),
  ADD CONSTRAINT devices_cluster_fkey FOREIGN KEY (cluster_id, organization_id)
    REFERENCES device_clusters (id, organization_id),
  ADD CONSTRAINT devices_cluster_fields_check
    CHECK (cluster_id IS NOT NULL OR (cluster_role IS NULL AND cluster_member_no IS NULL));
CREATE UNIQUE INDEX devices_cluster_member_no_idx ON devices (cluster_id, cluster_member_no)
  WHERE deleted_at IS NULL AND cluster_member_no IS NOT NULL;
CREATE INDEX devices_cluster_idx ON devices (cluster_id) WHERE cluster_id IS NOT NULL;

-- Hostname uniqueness moves to the API (see above); keep a plain index for the lookup.
DROP INDEX devices_org_hostname_live_idx;
CREATE INDEX devices_org_hostname_idx ON devices (organization_id, lower(hostname)) WHERE deleted_at IS NULL;
