-- P1-10 IPAM basics (SRS §5, ADR-014). VLAN numbers only mean something inside one L2 domain, so a VLAN belongs to a
-- site; site_id NULL = an organization-wide standard VLAN. Subnets may nest (a /16 per site holding /24s) but a CIDR is
-- unique per VRF. IP ranges plan addresses inside a subnet; usage is computed from interface IPs (ip_addresses).

CREATE TABLE vlans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  site_id          uuid,
  vid              integer NOT NULL CHECK (vid BETWEEN 1 AND 4094),
  name             text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 100),
  color            text NOT NULL DEFAULT '#64748b' CHECK (color ~ '^#[0-9a-f]{6}$'),
  description      text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),
  FOREIGN KEY (site_id, organization_id) REFERENCES sites (id, organization_id)
);
CREATE UNIQUE INDEX vlans_site_vid_idx ON vlans (organization_id, COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), vid);
CREATE TRIGGER vlans_updated_at BEFORE UPDATE ON vlans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE subnets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  site_id          uuid,
  vlan_id          uuid,
  cidr             cidr NOT NULL,
  vrf              text NOT NULL DEFAULT '' CHECK (length(vrf) <= 64),
  gateway          inet,
  description      text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),
  CHECK (gateway IS NULL OR (family(gateway) = family(cidr) AND gateway << cidr)),
  FOREIGN KEY (site_id, organization_id) REFERENCES sites (id, organization_id),
  FOREIGN KEY (vlan_id, organization_id) REFERENCES vlans (id, organization_id) ON DELETE SET NULL (vlan_id)
);
CREATE UNIQUE INDEX subnets_vrf_cidr_idx ON subnets (organization_id, vrf, cidr);
CREATE INDEX subnets_cidr_gist_idx ON subnets USING gist (cidr inet_ops);
CREATE INDEX subnets_site_idx ON subnets (organization_id, site_id);
CREATE TRIGGER subnets_updated_at BEFORE UPDATE ON subnets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ip_ranges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  subnet_id        uuid NOT NULL,
  start_ip         inet NOT NULL,
  end_ip           inet NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('dhcp', 'static', 'reserved')),
  purpose          text NOT NULL DEFAULT '' CHECK (length(purpose) <= 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CHECK (family(start_ip) = family(end_ip) AND start_ip <= end_ip),
  FOREIGN KEY (subnet_id, organization_id) REFERENCES subnets (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX ip_ranges_subnet_idx ON ip_ranges (subnet_id);
CREATE TRIGGER ip_ranges_updated_at BEFORE UPDATE ON ip_ranges FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Address lookups compare the host part of interface IPs.
CREATE INDEX ip_addresses_host_idx ON ip_addresses (organization_id, (host(address)::inet));

-- Every address in use: device interface IPs and cluster management IPs (an HA pair's shared IP is not on any
-- interface but must never be handed out again). Usage, next free and lookup all read from here.
CREATE VIEW ipam_addresses AS
SELECT ip.organization_id, ip.vrf, host(ip.address)::inet AS host, ip.address::text AS address, ip.role,
       d.id AS device_id, NULL::uuid AS cluster_id, d.hostname, COALESCE(i.name, '') AS interface_name,
       d.business_unit_id AS unit_id, d.site_id
FROM ip_addresses ip
JOIN devices d ON d.id = ip.device_id AND d.deleted_at IS NULL
LEFT JOIN interfaces i ON i.id = ip.interface_id
UNION ALL
SELECT c.organization_id, '' AS vrf, host(c.mgmt_ip)::inet, c.mgmt_ip::text, 'primary',
       NULL::uuid, c.id, COALESCE(NULLIF(c.hostname, ''), c.name), '', c.business_unit_id, c.site_id
FROM device_clusters c
WHERE c.mgmt_ip IS NOT NULL;
