-- P1-07c (ADR-029, ADR-031): permissions granted per partner or per business unit, plus record sharing.
-- Organization roles keep their meaning; the new role 'member' has no organization-wide data access and sees
-- only what partner/unit grants and shares give it.

ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('owner', 'admin', 'editor', 'viewer', 'member'));
-- site_scope (ADR-025) is replaced by the grants below.
ALTER TABLE memberships DROP COLUMN site_scope;

-- Grant on a partner: applies to every unit of the partner, including units created later.
CREATE TABLE partner_members (
  organization_id  uuid NOT NULL,
  partner_id       uuid NOT NULL,
  user_id          uuid NOT NULL,
  role             text NOT NULL CHECK (role IN ('partner_admin', 'editor', 'viewer')),
  granted_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  PRIMARY KEY (partner_id, user_id),
  FOREIGN KEY (partner_id, organization_id) REFERENCES partners (id, organization_id) ON DELETE CASCADE,
  -- Leaving the organization drops every grant in it.
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX partner_members_user_idx ON partner_members (organization_id, user_id);
CREATE TRIGGER partner_members_updated_at BEFORE UPDATE ON partner_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Grant on one business unit.
CREATE TABLE business_unit_members (
  organization_id   uuid NOT NULL,
  business_unit_id  uuid NOT NULL,
  user_id           uuid NOT NULL,
  role              text NOT NULL CHECK (role IN ('unit_admin', 'editor', 'viewer')),
  granted_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  PRIMARY KEY (business_unit_id, user_id),
  FOREIGN KEY (business_unit_id, organization_id) REFERENCES business_units (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX business_unit_members_user_idx ON business_unit_members (organization_id, user_id);
CREATE TRIGGER business_unit_members_updated_at BEFORE UPDATE ON business_unit_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Record sharing: one resource shared to a partner (all its units) or to one unit, read-only or editable.
-- Sites first; resource_id is checked by the API against resource_type (sites: same organization, live).
CREATE TABLE resource_shares (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  resource_type      text NOT NULL CHECK (resource_type IN ('site')),
  resource_id        uuid NOT NULL,
  target_type        text NOT NULL CHECK (target_type IN ('partner', 'business_unit')),
  target_partner_id  uuid,
  target_unit_id     uuid,
  access             text NOT NULL CHECK (access IN ('view', 'edit')),
  granted_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  granted_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CHECK ((target_type = 'partner' AND target_partner_id IS NOT NULL AND target_unit_id IS NULL)
      OR (target_type = 'business_unit' AND target_unit_id IS NOT NULL AND target_partner_id IS NULL)),
  FOREIGN KEY (target_partner_id, organization_id) REFERENCES partners (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (target_unit_id, organization_id) REFERENCES business_units (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX resource_shares_target_key
  ON resource_shares (resource_type, resource_id, target_type, COALESCE(target_partner_id, target_unit_id));
CREATE INDEX resource_shares_partner_idx ON resource_shares (target_partner_id) WHERE target_partner_id IS NOT NULL;
CREATE INDEX resource_shares_unit_idx ON resource_shares (target_unit_id) WHERE target_unit_id IS NOT NULL;
