-- P1-27 / P1-29 (ADR-032): a free-depth category tree replaces partners and business units. A site belongs to one
-- category or straight to the organization; its full code is derived from the path:
-- <ORG>-<category>-…-<site's own code>. Devices, clusters, endpoint groups and diagrams lose their business unit
-- (a device's category is its site's). Partners become top-level categories, their units child categories
-- (a lone default unit MAIN folds into its partner); organization-wide ("SHARED-…") sites move to the organization.

ALTER TABLE organizations ADD COLUMN code text;
UPDATE organizations SET code = left(upper(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')), 8);
UPDATE organizations SET code = 'ORG' WHERE code !~ '^[A-Z][A-Z0-9]{1,11}$';
ALTER TABLE organizations ALTER COLUMN code SET DEFAULT 'ORG', ALTER COLUMN code SET NOT NULL,
  ADD CONSTRAINT organizations_code_check CHECK (code ~ '^[A-Z][A-Z0-9]{1,11}$');

CREATE TABLE categories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  parent_id        uuid,
  code             text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9]{1,11}$'),
  name             text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 200),
  contact_name     text NOT NULL DEFAULT '' CHECK (length(contact_name) <= 200),
  contact_phone    text NOT NULL DEFAULT '' CHECK (length(contact_phone) <= 50),
  contact_email    text NOT NULL DEFAULT '' CHECK (length(contact_email) <= 320),
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),
  CHECK (parent_id IS DISTINCT FROM id),
  FOREIGN KEY (parent_id, organization_id) REFERENCES categories (id, organization_id) ON DELETE RESTRICT
);
-- Codes are unique among siblings (top-level categories are siblings under the organization).
CREATE UNIQUE INDEX categories_sibling_code_idx ON categories
  (organization_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
CREATE INDEX categories_parent_idx ON categories (organization_id, parent_id);
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Category names from the root down ("CJ Feed › Nhà máy Deheus") and a category with all its descendants.
CREATE FUNCTION category_path(cat uuid) RETURNS text LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT id, parent_id, name, 0 AS depth FROM categories WHERE id = cat
    UNION ALL
    SELECT c.id, c.parent_id, c.name, up.depth + 1 FROM categories c JOIN up ON c.id = up.parent_id
  )
  SELECT COALESCE(string_agg(name, ' › ' ORDER BY depth DESC), '') FROM up
$$;
CREATE FUNCTION category_subtree(cat uuid) RETURNS SETOF uuid LANGUAGE sql STABLE AS $$
  WITH RECURSIVE down AS (
    SELECT id FROM categories WHERE id = cat
    UNION ALL
    SELECT c.id FROM categories c JOIN down ON c.parent_id = down.id
  )
  SELECT id FROM down
$$;

-- Partners → top-level categories (same ids); units → children, except a partner's only unit MAIN.
INSERT INTO categories (id, organization_id, code, name, contact_name, contact_phone, contact_email, notes)
SELECT id, organization_id, code, name, contact_name, contact_phone, contact_email, notes
FROM partners WHERE deleted_at IS NULL;
CREATE TEMP TABLE unit_category ON COMMIT DROP AS
SELECT u.id AS unit_id,
       CASE WHEN u.code = 'MAIN' AND (SELECT count(*) FROM business_units o
                                      WHERE o.partner_id = u.partner_id AND o.deleted_at IS NULL) = 1
            THEN u.partner_id ELSE u.id END AS category_id,
       u.partner_id
FROM business_units u WHERE u.deleted_at IS NULL;
INSERT INTO categories (id, organization_id, parent_id, code, name, contact_name, contact_phone, contact_email, notes)
SELECT u.id, u.organization_id, u.partner_id, u.code, u.name, u.contact_name, u.contact_phone, u.contact_email, u.notes
FROM business_units u JOIN unit_category uc ON uc.unit_id = u.id AND uc.category_id = u.id;

-- Sites: own code + derived full code (longer now that paths can be deep).
ALTER TABLE sites ADD COLUMN category_id uuid,
  ADD COLUMN local_code text,
  ADD CONSTRAINT sites_category_fkey FOREIGN KEY (category_id, organization_id)
    REFERENCES categories (id, organization_id) ON DELETE RESTRICT;
UPDATE sites s SET category_id = uc.category_id FROM unit_category uc WHERE uc.unit_id = s.business_unit_id;
UPDATE sites SET local_code = upper(regexp_replace(CASE WHEN position('-' IN code::text) > 0
                                                        THEN substr(code::text, position('-' IN code::text) + 1)
                                                        ELSE code::text END, '[^A-Za-z0-9]', '', 'g'));
UPDATE sites SET local_code = 'SITE' WHERE local_code = '';
ALTER TABLE sites ALTER COLUMN local_code SET NOT NULL,
  ADD CONSTRAINT sites_local_code_check CHECK (local_code ~ '^[A-Z0-9]{1,12}$');
ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_code_check;
ALTER TABLE sites ADD CONSTRAINT sites_code_check CHECK (btrim(code::text) <> '' AND length(code) <= 160);
DROP INDEX sites_org_code_live_idx;
WITH RECURSIVE path AS (
  SELECT c.id, c.code::text AS codes FROM categories c WHERE c.parent_id IS NULL
  UNION ALL
  SELECT c.id, p.codes || '-' || c.code FROM categories c JOIN path p ON c.parent_id = p.id
)
UPDATE sites s SET code = o.code || '-' || p.codes || '-' || s.local_code
FROM organizations o, path p WHERE o.id = s.organization_id AND p.id = s.category_id;
UPDATE sites s SET code = o.code || '-' || s.local_code
FROM organizations o WHERE o.id = s.organization_id AND s.category_id IS NULL;
-- Rare clashes after re-coding (two old prefixes folding into one): keep them apart with a numeric suffix.
WITH d AS (
  SELECT id, row_number() OVER (PARTITION BY organization_id, code ORDER BY created_at) AS n
  FROM sites WHERE deleted_at IS NULL
)
UPDATE sites s SET code = s.code || '-' || d.n, local_code = left(s.local_code || d.n, 12)
FROM d WHERE d.id = s.id AND d.n > 1;
CREATE UNIQUE INDEX sites_org_code_live_idx ON sites (organization_id, code) WHERE deleted_at IS NULL;
CREATE INDEX sites_category_idx ON sites (organization_id, category_id);

-- Everything else loses its business unit.
DROP VIEW ipam_addresses;
ALTER TABLE devices DROP COLUMN business_unit_id;
ALTER TABLE device_clusters DROP COLUMN business_unit_id;
ALTER TABLE endpoint_groups DROP COLUMN business_unit_id;
ALTER TABLE diagrams DROP CONSTRAINT diagrams_check;
DROP INDEX diagrams_scope_name_idx;
ALTER TABLE diagrams DROP COLUMN business_unit_id, DROP COLUMN site_id, DROP COLUMN scope;
CREATE UNIQUE INDEX diagrams_org_name_idx ON diagrams (organization_id, lower(name));
ALTER TABLE sites DROP COLUMN business_unit_id;
DROP TABLE business_units;
DROP TABLE partners;

CREATE VIEW ipam_addresses AS
SELECT ip.organization_id, ip.vrf, host(ip.address)::inet AS host, ip.address::text AS address, ip.role,
       d.id AS device_id, NULL::uuid AS cluster_id, NULL::uuid AS group_id, d.hostname,
       COALESCE(i.name, '') AS interface_name, d.site_id
FROM ip_addresses ip
JOIN devices d ON d.id = ip.device_id AND d.deleted_at IS NULL
LEFT JOIN interfaces i ON i.id = ip.interface_id
UNION ALL
SELECT c.organization_id, '' AS vrf, host(c.mgmt_ip)::inet, c.mgmt_ip::text, 'primary',
       NULL::uuid, c.id, NULL::uuid, COALESCE(NULLIF(c.hostname, ''), c.name), '', c.site_id
FROM device_clusters c
WHERE c.mgmt_ip IS NOT NULL
UNION ALL
SELECT em.organization_id, COALESCE(sn.vrf, ''), em.ip, COALESCE(set_masklen(em.ip, masklen(sn.cidr))::text, em.ip::text),
       'primary', NULL::uuid, NULL::uuid, g.id, em.name, g.name, g.site_id
FROM endpoint_members em
JOIN endpoint_groups g ON g.id = em.group_id
LEFT JOIN ip_ranges r ON r.id = g.ip_range_id
LEFT JOIN subnets sn ON sn.id = r.subnet_id
WHERE em.ip IS NOT NULL;
