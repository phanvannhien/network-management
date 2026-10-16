-- P1-07 / ADR-026, ADR-030: business units between the organization and its sites.
-- Site kind, owning unit (NULL = shared by the whole organization, e.g. an IDC) and main ISP.

CREATE TABLE business_units (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  -- ADR-030: 2–8 characters A–Z/0–9 starting with a letter, stored upper-case.
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
  UNIQUE (id, organization_id)
);
-- "SHARED" is the prefix of organization-wide sites, so no unit may take it.
ALTER TABLE business_units ADD CONSTRAINT business_units_code_not_shared CHECK (code <> 'SHARED');
CREATE UNIQUE INDEX business_units_org_code_live_idx ON business_units (organization_id, code) WHERE deleted_at IS NULL;
CREATE TRIGGER business_units_updated_at BEFORE UPDATE ON business_units FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE sites
  ADD COLUMN kind text NOT NULL DEFAULT 'office'
    CHECK (kind IN ('office', 'factory', 'datacenter', 'warehouse', 'store', 'other')),
  ADD COLUMN business_unit_id uuid,
  ADD COLUMN isp text NOT NULL DEFAULT '' CHECK (length(isp) <= 200),
  -- Same organization guaranteed by the database; NULL = shared site (MATCH SIMPLE skips the check).
  ADD CONSTRAINT sites_business_unit_fkey FOREIGN KEY (business_unit_id, organization_id)
    REFERENCES business_units (id, organization_id) ON DELETE RESTRICT;
CREATE INDEX sites_business_unit_idx ON sites (organization_id, business_unit_id);
