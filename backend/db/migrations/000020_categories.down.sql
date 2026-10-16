-- Lossy way back to partners / business units (ADR-031): top-level categories become partners with one unit MAIN;
-- deeper levels fold into their top-level ancestor; sites without a category go to a fallback partner GENERAL.
DROP VIEW ipam_addresses;

CREATE TABLE partners (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  code             text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9]{1,7}$'),
  name             text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 200),
  relation         text NOT NULL DEFAULT 'subsidiary' CHECK (relation IN ('subsidiary', 'partner', 'customer')),
  contact_name     text NOT NULL DEFAULT '' CHECK (length(contact_name) <= 200),
  contact_phone    text NOT NULL DEFAULT '' CHECK (length(contact_phone) <= 50),
  contact_email    text NOT NULL DEFAULT '' CHECK (length(contact_email) <= 320),
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),
  CONSTRAINT partners_code_not_shared CHECK (code <> 'SHARED')
);
CREATE UNIQUE INDEX partners_org_code_live_idx ON partners (organization_id, code) WHERE deleted_at IS NULL;
CREATE TRIGGER partners_updated_at BEFORE UPDATE ON partners FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE business_units (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  partner_id       uuid NOT NULL,
  code             text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9]{1,7}$'),
  name             text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 200),
  contact_name     text NOT NULL DEFAULT '' CHECK (length(contact_name) <= 200),
  contact_phone    text NOT NULL DEFAULT '' CHECK (length(contact_phone) <= 50),
  contact_email    text NOT NULL DEFAULT '' CHECK (length(contact_email) <= 320),
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),
  FOREIGN KEY (partner_id, organization_id) REFERENCES partners (id, organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX business_units_partner_code_live_idx ON business_units (partner_id, code) WHERE deleted_at IS NULL;
CREATE TRIGGER business_units_updated_at BEFORE UPDATE ON business_units FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO partners (id, organization_id, code, name, contact_name, contact_phone, contact_email, notes)
SELECT id, organization_id, left(code, 8), name, contact_name, contact_phone, contact_email, notes
FROM categories WHERE parent_id IS NULL;
INSERT INTO partners (organization_id, code, name)
SELECT DISTINCT organization_id, 'GENERAL', 'General' FROM sites WHERE category_id IS NULL;
INSERT INTO business_units (id, organization_id, partner_id, code, name)
SELECT gen_random_uuid(), p.organization_id, p.id, 'MAIN', p.name FROM partners p;

ALTER TABLE sites ADD COLUMN business_unit_id uuid;
WITH RECURSIVE top AS (
  SELECT id, id AS root FROM categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, t.root FROM categories c JOIN top t ON c.parent_id = t.id
)
UPDATE sites s SET business_unit_id = u.id
FROM top t JOIN business_units u ON u.partner_id = t.root
WHERE t.id = s.category_id;
UPDATE sites s SET business_unit_id = u.id
FROM business_units u JOIN partners p ON p.id = u.partner_id AND p.code = 'GENERAL'
WHERE s.category_id IS NULL AND p.organization_id = s.organization_id;
ALTER TABLE sites ADD CONSTRAINT sites_business_unit_fkey FOREIGN KEY (business_unit_id, organization_id)
  REFERENCES business_units (id, organization_id) ON DELETE RESTRICT;
CREATE INDEX sites_business_unit_idx ON sites (organization_id, business_unit_id);

-- Owned records take their site's unit.
ALTER TABLE devices ADD COLUMN business_unit_id uuid;
UPDATE devices d SET business_unit_id = s.business_unit_id FROM sites s WHERE s.id = d.site_id;
ALTER TABLE devices ALTER COLUMN business_unit_id SET NOT NULL,
  ADD CONSTRAINT devices_business_unit_id_organization_id_fkey FOREIGN KEY (business_unit_id, organization_id)
    REFERENCES business_units (id, organization_id);
CREATE INDEX devices_unit_idx ON devices (organization_id, business_unit_id) WHERE deleted_at IS NULL;
ALTER TABLE device_clusters ADD COLUMN business_unit_id uuid;
UPDATE device_clusters c SET business_unit_id = s.business_unit_id FROM sites s WHERE s.id = c.site_id;
ALTER TABLE device_clusters ALTER COLUMN business_unit_id SET NOT NULL,
  ADD CONSTRAINT device_clusters_business_unit_id_organization_id_fkey FOREIGN KEY (business_unit_id, organization_id)
    REFERENCES business_units (id, organization_id);
ALTER TABLE endpoint_groups ADD COLUMN business_unit_id uuid;
UPDATE endpoint_groups g SET business_unit_id = s.business_unit_id FROM sites s WHERE s.id = g.site_id;
ALTER TABLE endpoint_groups ALTER COLUMN business_unit_id SET NOT NULL,
  ADD CONSTRAINT endpoint_groups_business_unit_id_organization_id_fkey FOREIGN KEY (business_unit_id, organization_id)
    REFERENCES business_units (id, organization_id);

-- Diagrams return as organization-wide.
DROP INDEX diagrams_org_name_idx;
ALTER TABLE diagrams ADD COLUMN scope text NOT NULL DEFAULT 'organization'
    CHECK (scope IN ('organization', 'business_unit', 'site')),
  ADD COLUMN business_unit_id uuid, ADD COLUMN site_id uuid,
  ADD CONSTRAINT diagrams_check CHECK ((scope = 'organization' AND business_unit_id IS NULL AND site_id IS NULL)
      OR (scope = 'business_unit' AND business_unit_id IS NOT NULL AND site_id IS NULL)
      OR (scope = 'site' AND site_id IS NOT NULL AND business_unit_id IS NULL)),
  ADD FOREIGN KEY (business_unit_id, organization_id) REFERENCES business_units (id, organization_id),
  ADD FOREIGN KEY (site_id, organization_id) REFERENCES sites (id, organization_id);
CREATE UNIQUE INDEX diagrams_scope_name_idx ON diagrams
  (organization_id, scope, COALESCE(business_unit_id, site_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

DROP INDEX sites_category_idx;
DROP INDEX sites_org_code_live_idx;
CREATE UNIQUE INDEX sites_org_code_live_idx ON sites (organization_id, code) WHERE deleted_at IS NULL;
ALTER TABLE sites DROP COLUMN category_id, DROP COLUMN local_code;
DROP FUNCTION category_subtree(uuid);
DROP FUNCTION category_path(uuid);
DROP TABLE categories;
ALTER TABLE organizations DROP COLUMN code;

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
