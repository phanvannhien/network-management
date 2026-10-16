-- P1-09 templates & interfaces (SRS §4.2–4.3, ADR-012). IPs live on interfaces; the management IP of a device is the
-- primary IP of its management interface (derived, never typed). NAT/public IPs may hang on the device itself.

-- Device templates of an organization: defaults for new devices and the physical ports to generate.
CREATE TABLE device_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 100),
  type             text NOT NULL,
  vendor           text NOT NULL DEFAULT '' CHECK (length(vendor) <= 100),
  model            text NOT NULL DEFAULT '' CHECK (length(model) <= 100),
  part_number      text NOT NULL DEFAULT '' CHECK (length(part_number) <= 100),
  u_height         integer NOT NULL DEFAULT 1 CHECK (u_height BETWEEN 1 AND 60),
  -- Port groups: [{"pattern": "Gi1/0/{n}", "start": 1, "count": 24, "media": "RJ45", "speed": "1G", "poe": true}]
  ports            jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(ports) = 'array'),
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX device_templates_org_name_idx ON device_templates (organization_id, lower(name));
CREATE TRIGGER device_templates_updated_at BEFORE UPDATE ON device_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE interfaces (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  device_id        uuid NOT NULL,
  name             text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 64),
  kind             text NOT NULL CHECK (kind IN ('physical', 'svi', 'loopback', 'tunnel', 'subinterface', 'lag')),
  media            text NOT NULL DEFAULT ''
                   CHECK (media IN ('', 'RJ45', 'SFP', 'SFP+', 'SFP28', 'QSFP', 'Serial', 'Radio', 'Console')),
  speed            text NOT NULL DEFAULT '' CHECK (length(speed) <= 20),
  duplex           text NOT NULL DEFAULT 'auto' CHECK (duplex IN ('auto', 'full', 'half')),
  mode             text NOT NULL DEFAULT '' CHECK (mode IN ('', 'access', 'trunk', 'routed', 'hybrid')),
  access_vlan      integer CHECK (access_vlan BETWEEN 1 AND 4094),
  native_vlan      integer CHECK (native_vlan BETWEEN 1 AND 4094),
  allowed_vlans    text NOT NULL DEFAULT '' CHECK (allowed_vlans ~ '^([0-9]{1,4}(-[0-9]{1,4})?(,[0-9]{1,4}(-[0-9]{1,4})?)*)?$'),
  poe              boolean NOT NULL DEFAULT false,
  lag_id           uuid,
  description      text NOT NULL DEFAULT '' CHECK (length(description) <= 200),
  admin_up         boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (id, device_id),
  FOREIGN KEY (device_id, organization_id) REFERENCES devices (id, organization_id) ON DELETE CASCADE,
  -- A LAG member points at a LAG of the same device; deleting the LAG frees its members.
  FOREIGN KEY (lag_id, device_id) REFERENCES interfaces (id, device_id) ON DELETE SET NULL (lag_id)
);
CREATE UNIQUE INDEX interfaces_device_name_idx ON interfaces (device_id, lower(name));
CREATE INDEX interfaces_org_idx ON interfaces (organization_id);
CREATE TRIGGER interfaces_updated_at BEFORE UPDATE ON interfaces FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ip_addresses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  device_id        uuid NOT NULL,
  interface_id     uuid,
  address          inet NOT NULL,
  vrf              text NOT NULL DEFAULT '' CHECK (length(vrf) <= 64),
  role             text NOT NULL CHECK (role IN ('primary', 'secondary', 'nat', 'public')),
  description      text NOT NULL DEFAULT '' CHECK (length(description) <= 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  -- Configured IPs sit on an interface; NAT/public ones may belong to the device only (ADR-012).
  CHECK (interface_id IS NOT NULL OR role IN ('nat', 'public')),
  FOREIGN KEY (device_id, organization_id) REFERENCES devices (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (interface_id, device_id) REFERENCES interfaces (id, device_id) ON DELETE CASCADE
);
-- One primary IP per interface per address family.
CREATE UNIQUE INDEX ip_addresses_primary_idx ON ip_addresses (interface_id, family(address)) WHERE role = 'primary';
CREATE UNIQUE INDEX ip_addresses_iface_addr_idx ON ip_addresses (device_id, COALESCE(interface_id, device_id), address);
CREATE INDEX ip_addresses_org_addr_idx ON ip_addresses (organization_id, address);
CREATE INDEX ip_addresses_device_idx ON ip_addresses (device_id);
CREATE TRIGGER ip_addresses_updated_at BEFORE UPDATE ON ip_addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE devices
  ADD COLUMN mgmt_interface_id uuid,
  ADD COLUMN poll_address inet,
  ADD COLUMN template_id uuid,
  ADD CONSTRAINT devices_mgmt_interface_fkey FOREIGN KEY (mgmt_interface_id, id)
    REFERENCES interfaces (id, device_id) ON DELETE SET NULL (mgmt_interface_id),
  ADD CONSTRAINT devices_template_fkey FOREIGN KEY (template_id, organization_id)
    REFERENCES device_templates (id, organization_id) ON DELETE SET NULL (template_id);
