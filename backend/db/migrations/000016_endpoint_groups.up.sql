-- P1-11 endpoint groups (SRS §4.4, ADR-013/014): many similar end devices (cameras, PCs, phones…) kept as one
-- inventory item and drawn as one node with a "used / total" badge. Members are light records (name, IP, MAC, the
-- switch port they plug into) that can be promoted to a full device. Ownership and access follow devices: a site
-- and an owner business unit (the site's unit, or a chosen one in a shared site).

ALTER TABLE ip_ranges ADD CONSTRAINT ip_ranges_id_org_key UNIQUE (id, organization_id);

CREATE TABLE endpoint_groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  business_unit_id  uuid NOT NULL,
  site_id           uuid NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('pc', 'laptop', 'printer', 'ip_camera', 'ip_phone', 'access_point',
                                                  'access_control', 'video_conference', 'iot', 'server', 'vm', 'nas',
                                                  'other')),
  name              text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 100),
  ip_range_id       uuid,
  expected_count    integer CHECK (expected_count BETWEEN 0 AND 100000),
  notes             text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),
  FOREIGN KEY (business_unit_id, organization_id) REFERENCES business_units (id, organization_id),
  FOREIGN KEY (site_id, organization_id) REFERENCES sites (id, organization_id),
  FOREIGN KEY (ip_range_id, organization_id) REFERENCES ip_ranges (id, organization_id) ON DELETE SET NULL (ip_range_id)
);
CREATE UNIQUE INDEX endpoint_groups_site_name_idx ON endpoint_groups (organization_id, site_id, lower(name));
CREATE INDEX endpoint_groups_range_idx ON endpoint_groups (ip_range_id);
CREATE TRIGGER endpoint_groups_updated_at BEFORE UPDATE ON endpoint_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE endpoint_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  group_id          uuid NOT NULL,
  name              text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 100),
  ip                inet CHECK (ip IS NULL OR masklen(ip) = CASE WHEN family(ip) = 4 THEN 32 ELSE 128 END),
  mac               macaddr,
  interface_id      uuid,
  notes             text NOT NULL DEFAULT '' CHECK (length(notes) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  FOREIGN KEY (group_id, organization_id) REFERENCES endpoint_groups (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (interface_id) REFERENCES interfaces (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX endpoint_members_name_idx ON endpoint_members (group_id, lower(name));
CREATE UNIQUE INDEX endpoint_members_ip_idx ON endpoint_members (group_id, ip) WHERE ip IS NOT NULL;
CREATE INDEX endpoint_members_ip_lookup_idx ON endpoint_members (organization_id, ip);
CREATE TRIGGER endpoint_members_updated_at BEFORE UPDATE ON endpoint_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Member IPs are in use too (planned in ADR-014): their VRF is the VRF of the group's range's subnet.
DROP VIEW ipam_addresses;
CREATE VIEW ipam_addresses AS
SELECT ip.organization_id, ip.vrf, host(ip.address)::inet AS host, ip.address::text AS address, ip.role,
       d.id AS device_id, NULL::uuid AS cluster_id, NULL::uuid AS group_id, d.hostname,
       COALESCE(i.name, '') AS interface_name, d.business_unit_id AS unit_id, d.site_id
FROM ip_addresses ip
JOIN devices d ON d.id = ip.device_id AND d.deleted_at IS NULL
LEFT JOIN interfaces i ON i.id = ip.interface_id
UNION ALL
SELECT c.organization_id, '' AS vrf, host(c.mgmt_ip)::inet, c.mgmt_ip::text, 'primary',
       NULL::uuid, c.id, NULL::uuid, COALESCE(NULLIF(c.hostname, ''), c.name), '', c.business_unit_id, c.site_id
FROM device_clusters c
WHERE c.mgmt_ip IS NOT NULL
UNION ALL
SELECT em.organization_id, COALESCE(sn.vrf, ''), em.ip, COALESCE(set_masklen(em.ip, masklen(sn.cidr))::text, em.ip::text),
       'primary', NULL::uuid, NULL::uuid, g.id, em.name, g.name, g.business_unit_id, g.site_id
FROM endpoint_members em
JOIN endpoint_groups g ON g.id = em.group_id
LEFT JOIN ip_ranges r ON r.id = g.ip_range_id
LEFT JOIN subnets sn ON sn.id = r.subnet_id
WHERE em.ip IS NOT NULL;
