-- P1-07b / ADR-031: Organization → Partner → Business unit → Site.
-- The business units created in P1-07 become partners (ids, codes, relation and contacts kept); every partner
-- gets a default unit MAIN and its sites move to it. Site codes keep the partner prefix, so none change.

ALTER TABLE sites DROP CONSTRAINT sites_business_unit_fkey;

ALTER TABLE business_units RENAME TO partners;
ALTER TABLE partners RENAME CONSTRAINT business_units_code_not_shared TO partners_code_not_shared;
ALTER INDEX business_units_org_code_live_idx RENAME TO partners_org_code_live_idx;
ALTER INDEX business_units_pkey RENAME TO partners_pkey;
ALTER INDEX business_units_id_organization_id_key RENAME TO partners_id_organization_id_key;
ALTER TRIGGER business_units_updated_at ON partners RENAME TO partners_updated_at;

CREATE TABLE business_units (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  partner_id       uuid NOT NULL,
  -- Same rule as partner codes (ADR-030/031), unique within the partner.
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
CREATE INDEX business_units_org_idx ON business_units (organization_id, partner_id);
CREATE TRIGGER business_units_updated_at BEFORE UPDATE ON business_units FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Default unit per partner (deleted partners get a deleted unit so their old sites stay consistent).
INSERT INTO business_units (organization_id, partner_id, code, name, deleted_at)
SELECT organization_id, id, 'MAIN', name, deleted_at FROM partners;

UPDATE sites s SET business_unit_id = u.id
FROM business_units u
WHERE u.partner_id = s.business_unit_id AND u.code = 'MAIN';

ALTER TABLE sites ADD CONSTRAINT sites_business_unit_fkey FOREIGN KEY (business_unit_id, organization_id)
  REFERENCES business_units (id, organization_id) ON DELETE RESTRICT;
