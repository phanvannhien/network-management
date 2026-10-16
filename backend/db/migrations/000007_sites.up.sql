-- P1-07 / ADR-025: sites → location tree (building → floor → room) → racks.
-- Composite foreign keys keep every child inside its parent's organization (and locations inside one site),
-- so a bug in a handler cannot attach data across tenants.

CREATE TABLE sites (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  code             citext NOT NULL CHECK (btrim(code::text) <> '' AND length(code) <= 32),
  name             text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 200),
  address          text NOT NULL DEFAULT '' CHECK (length(address) <= 500),
  timezone         text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
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
-- Codes are unique among live sites; a soft-deleted site frees its code.
CREATE UNIQUE INDEX sites_org_code_live_idx ON sites (organization_id, code) WHERE deleted_at IS NULL;
CREATE TRIGGER sites_updated_at BEFORE UPDATE ON sites FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE locations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  site_id          uuid NOT NULL,
  parent_id        uuid,
  kind             text NOT NULL CHECK (kind IN ('building', 'floor', 'room')),
  name             text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 100),
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (id, site_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (site_id, organization_id) REFERENCES sites (id, organization_id) ON DELETE RESTRICT,
  -- Parent must be in the same site; RESTRICT: a node with children cannot be deleted.
  FOREIGN KEY (parent_id, site_id) REFERENCES locations (id, site_id) ON DELETE RESTRICT
);
-- Sibling names are unique (case-insensitive) so "Tầng 3" and "tầng 3" cannot both exist.
CREATE UNIQUE INDEX locations_sibling_name_idx
  ON locations (site_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX locations_site_idx ON locations (organization_id, site_id);
CREATE TRIGGER locations_updated_at BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE racks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  site_id          uuid NOT NULL,
  location_id      uuid NOT NULL,
  name             text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 100),
  u_height         integer NOT NULL DEFAULT 42 CHECK (u_height BETWEEN 1 AND 60),
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),
  FOREIGN KEY (site_id, organization_id) REFERENCES sites (id, organization_id) ON DELETE RESTRICT,
  -- The location must belong to the same site; RESTRICT: a location holding racks cannot be deleted.
  FOREIGN KEY (location_id, site_id) REFERENCES locations (id, site_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX racks_location_name_idx ON racks (location_id, lower(name));
CREATE INDEX racks_site_idx ON racks (organization_id, site_id);
CREATE TRIGGER racks_updated_at BEFORE UPDATE ON racks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
