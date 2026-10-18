-- Segments (P2-08, ADR-047): a network shared by three or more parties that cables end in, with no port at its end —
-- an MPLS L3VPN, a Metro / VPLS service, a building's shared LAN. Not tied to a site (it spans several).
CREATE TABLE segments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 100),
  kind             text NOT NULL CHECK (kind IN ('mpls_l3vpn', 'metro_l2', 'shared_lan', 'other')),
  vendor_id        uuid,
  service_id       text NOT NULL DEFAULT '' CHECK (length(service_id) <= 100),
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),
  FOREIGN KEY (vendor_id, organization_id) REFERENCES vendors (id, organization_id) ON DELETE SET NULL (vendor_id)
);
CREATE UNIQUE INDEX segments_org_name_idx ON segments (organization_id, lower(name));
CREATE TRIGGER segments_updated_at BEFORE UPDATE ON segments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Cables may end in a segment, never on a port of it.
ALTER TABLE links DROP CONSTRAINT links_a_kind_check;
ALTER TABLE links DROP CONSTRAINT links_b_kind_check;
ALTER TABLE links ADD CONSTRAINT links_a_kind_check CHECK (a_kind IN ('device', 'endpoint_group', 'segment'));
ALTER TABLE links ADD CONSTRAINT links_b_kind_check CHECK (b_kind IN ('device', 'endpoint_group', 'segment'));
ALTER TABLE links ADD CONSTRAINT links_segment_no_port_check
  CHECK ((a_kind <> 'segment' OR a_interface_id IS NULL) AND (b_kind <> 'segment' OR b_interface_id IS NULL));
