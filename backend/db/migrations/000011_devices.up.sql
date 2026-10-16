-- P1-08 device inventory (SRS §4.1, ADR-026, ADR-031). Interfaces / management IP (P1-09), clusters (P1-09b),
-- vendors, contracts and credentials (Phase 2) and monitoring (Phase 3) come later.

-- Racks are referenced together with their site so a device cannot sit in another site's rack.
ALTER TABLE racks ADD CONSTRAINT racks_id_site_key UNIQUE (id, site_id);

CREATE TABLE devices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Owner: the site's unit, or for a shared site the unit chosen for the device (ADR-026).
  business_unit_id  uuid NOT NULL,
  site_id           uuid NOT NULL,
  location_id       uuid,
  rack_id           uuid,
  rack_u            integer CHECK (rack_u BETWEEN 1 AND 60),
  u_height          integer NOT NULL DEFAULT 1 CHECK (u_height BETWEEN 1 AND 60),
  hostname          text NOT NULL CHECK (btrim(hostname) <> '' AND length(hostname) <= 253),
  type              text NOT NULL,
  vendor            text NOT NULL DEFAULT '' CHECK (length(vendor) <= 100),
  model             text NOT NULL DEFAULT '' CHECK (length(model) <= 100),
  part_number       text NOT NULL DEFAULT '' CHECK (length(part_number) <= 100),
  serial_number     text NOT NULL DEFAULT '' CHECK (length(serial_number) <= 100),
  asset_tag         text NOT NULL DEFAULT '' CHECK (length(asset_tag) <= 100),
  firmware          text NOT NULL DEFAULT '' CHECK (length(firmware) <= 100),
  role              text NOT NULL DEFAULT 'none'
                    CHECK (role IN ('none', 'core', 'distribution', 'access', 'edge', 'dmz', 'oob')),
  lifecycle         text NOT NULL DEFAULT 'active'
                    CHECK (lifecycle IN ('planned', 'active', 'spare', 'rma', 'retired')),
  managed           boolean NOT NULL DEFAULT true,
  owner_name        text NOT NULL DEFAULT '' CHECK (length(owner_name) <= 200),
  purchase_date     date,
  po_number         text NOT NULL DEFAULT '' CHECK (length(po_number) <= 100),
  warranty_end      date,
  license_end       date,
  eol_date          date,
  eos_date          date,
  notes             text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  tags              text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 50),
  custom_fields     jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(custom_fields) = 'object'),
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),
  FOREIGN KEY (business_unit_id, organization_id) REFERENCES business_units (id, organization_id),
  FOREIGN KEY (site_id, organization_id) REFERENCES sites (id, organization_id),
  -- Location and rack belong to the device's site. Deleting them is refused by the API while live devices use
  -- them; soft-deleted devices just lose the reference (rack_u without rack_id is ignored).
  FOREIGN KEY (location_id, site_id) REFERENCES locations (id, site_id) ON DELETE SET NULL (location_id),
  FOREIGN KEY (rack_id, site_id) REFERENCES racks (id, site_id) ON DELETE SET NULL (rack_id)
);
-- Hostnames are unique among live devices of an organization (case-insensitive, SRS §4.1).
CREATE UNIQUE INDEX devices_org_hostname_live_idx ON devices (organization_id, lower(hostname)) WHERE deleted_at IS NULL;
CREATE INDEX devices_site_idx ON devices (organization_id, site_id) WHERE deleted_at IS NULL;
CREATE INDEX devices_unit_idx ON devices (organization_id, business_unit_id) WHERE deleted_at IS NULL;
CREATE INDEX devices_rack_idx ON devices (rack_id) WHERE rack_id IS NOT NULL;
CREATE INDEX devices_serial_idx ON devices (organization_id, lower(serial_number)) WHERE serial_number <> '';
CREATE INDEX devices_tags_idx ON devices USING gin (tags);
CREATE TRIGGER devices_updated_at BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Custom fields declared per organization (SRS §4.1 "Mở rộng"); values live in devices.custom_fields by key.
CREATE TABLE custom_field_defs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  key              text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label            text NOT NULL CHECK (btrim(label) <> '' AND length(label) <= 100),
  kind             text NOT NULL CHECK (kind IN ('text', 'number', 'date', 'boolean', 'select')),
  options          text[] NOT NULL DEFAULT '{}' CHECK (cardinality(options) <= 100),
  required         boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, key)
);
CREATE TRIGGER custom_field_defs_updated_at BEFORE UPDATE ON custom_field_defs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
