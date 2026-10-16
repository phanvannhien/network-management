-- P1-12 links (SRS §6.2, ADR-012/013): a connection between two ends, each a device or an endpoint group. A device end
-- may name its interface (port → port) or leave it empty (logical drawing, port assigned later). Links live in the
-- inventory independently of diagrams (ADR-015). Rules the database cannot express across the two end columns —
-- one physical link per physical port, interface kind vs link kind — are checked by the API under a lock.

CREATE TABLE links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  a_kind            text NOT NULL CHECK (a_kind IN ('device', 'endpoint_group')),
  a_id              uuid NOT NULL,
  a_interface_id    uuid REFERENCES interfaces (id) ON DELETE SET NULL,
  b_kind            text NOT NULL CHECK (b_kind IN ('device', 'endpoint_group')),
  b_id              uuid NOT NULL,
  b_interface_id    uuid REFERENCES interfaces (id) ON DELETE SET NULL,
  kind              text NOT NULL CHECK (kind IN ('ethernet', 'fiber', 'wireless', 'serial', 'logical', 'console')),
  medium            text NOT NULL DEFAULT '' CHECK (length(medium) <= 40),
  speed             text NOT NULL DEFAULT '' CHECK (length(speed) <= 20),
  length_m          numeric(8, 1) CHECK (length_m > 0),
  cable_id          text NOT NULL DEFAULT '' CHECK (length(cable_id) <= 64),
  status            text NOT NULL DEFAULT 'up' CHECK (status IN ('planned', 'up', 'down')),
  provider          text NOT NULL DEFAULT '' CHECK (length(provider) <= 100),
  circuit_id        text NOT NULL DEFAULT '' CHECK (length(circuit_id) <= 100),
  bandwidth         text NOT NULL DEFAULT '' CHECK (length(bandwidth) <= 40),
  notes             text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  CHECK (a_kind <> b_kind OR a_id <> b_id OR a_interface_id IS DISTINCT FROM b_interface_id)
);
CREATE INDEX links_a_idx ON links (organization_id, a_kind, a_id);
CREATE INDEX links_b_idx ON links (organization_id, b_kind, b_id);
CREATE INDEX links_a_iface_idx ON links (a_interface_id);
CREATE INDEX links_b_iface_idx ON links (b_interface_id);
CREATE TRIGGER links_updated_at BEFORE UPDATE ON links FOR EACH ROW EXECUTE FUNCTION set_updated_at();
