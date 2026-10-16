-- P1-13 diagrams (ADR-015, ADR-028): a diagram is a view over the inventory — node positions, edge routing,
-- annotations, viewport — stored as JSONB that references devices / endpoint groups / sites / links by id.
-- It belongs to the organization with a scope: the whole organization, one business unit or one site.

CREATE TABLE diagrams (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  scope             text NOT NULL CHECK (scope IN ('organization', 'business_unit', 'site')),
  business_unit_id  uuid,
  site_id           uuid,
  name              text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 120),
  layer             text NOT NULL DEFAULT 'physical' CHECK (layer IN ('overview', 'physical', 'l2', 'l3')),
  description       text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  view              jsonb NOT NULL DEFAULT '{}' CHECK (octet_length(view::text) <= 4194304),
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  CHECK ((scope = 'organization' AND business_unit_id IS NULL AND site_id IS NULL)
      OR (scope = 'business_unit' AND business_unit_id IS NOT NULL AND site_id IS NULL)
      OR (scope = 'site' AND site_id IS NOT NULL AND business_unit_id IS NULL)),
  FOREIGN KEY (business_unit_id, organization_id) REFERENCES business_units (id, organization_id),
  FOREIGN KEY (site_id, organization_id) REFERENCES sites (id, organization_id)
);
CREATE UNIQUE INDEX diagrams_scope_name_idx ON diagrams
  (organization_id, scope, COALESCE(business_unit_id, site_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE TRIGGER diagrams_updated_at BEFORE UPDATE ON diagrams FOR EACH ROW EXECUTE FUNCTION set_updated_at();
