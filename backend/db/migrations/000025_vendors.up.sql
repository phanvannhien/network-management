-- P2-04 (ADR-044): vendors (manufacturers, suppliers, ISPs, maintenance companies…), their contacts, contracts that
-- cover devices and WAN links, and files attached to contracts. All per organization.

CREATE TABLE vendors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('manufacturer', 'supplier', 'isp', 'maintenance', 'customer', 'other')),
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  tax_code         text NOT NULL DEFAULT '' CHECK (length(tax_code) <= 50),
  website          text NOT NULL DEFAULT '' CHECK (length(website) <= 300),
  support_phone    text NOT NULL DEFAULT '' CHECK (length(support_phone) <= 100),
  support_email    text NOT NULL DEFAULT '' CHECK (length(support_email) <= 320),
  support_portal   text NOT NULL DEFAULT '' CHECK (length(support_portal) <= 300),
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  deleted_at       timestamptz
);
CREATE UNIQUE INDEX vendors_org_name_live_idx ON vendors (organization_id, lower(name)) WHERE deleted_at IS NULL;
CREATE TRIGGER vendors_updated_at BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vendor_contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  vendor_id        uuid NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  title            text NOT NULL DEFAULT '' CHECK (length(title) <= 200),
  phone            text NOT NULL DEFAULT '' CHECK (length(phone) <= 100),
  email            text NOT NULL DEFAULT '' CHECK (length(email) <= 320),
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1
);
CREATE INDEX vendor_contacts_vendor_idx ON vendor_contacts (organization_id, vendor_id);
CREATE TRIGGER vendor_contacts_updated_at BEFORE UPDATE ON vendor_contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One contract = one service with one end date (FortiCare and FortiGuard of the same box are two contracts).
CREATE TABLE contracts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  vendor_id        uuid NOT NULL REFERENCES vendors (id),
  kind             text NOT NULL CHECK (kind IN ('support', 'warranty', 'license', 'isp', 'maintenance', 'other')),
  number           text NOT NULL DEFAULT '' CHECK (length(number) <= 100),
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  start_date       date,
  end_date         date,
  sla              text NOT NULL DEFAULT '' CHECK (length(sla) <= 500),
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  deleted_at       timestamptz,
  CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);
CREATE INDEX contracts_vendor_idx ON contracts (organization_id, vendor_id) WHERE deleted_at IS NULL;
CREATE INDEX contracts_end_idx ON contracts (organization_id, end_date) WHERE deleted_at IS NULL;
CREATE TRIGGER contracts_updated_at BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What a contract covers: devices and links (an ISP contract covers WAN links).
CREATE TABLE contract_items (
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  contract_id      uuid NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
  device_id        uuid REFERENCES devices (id) ON DELETE CASCADE,
  link_id          uuid REFERENCES links (id) ON DELETE CASCADE,
  CHECK ((device_id IS NULL) <> (link_id IS NULL))
);
CREATE UNIQUE INDEX contract_items_device_idx ON contract_items (contract_id, device_id) WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX contract_items_link_idx ON contract_items (contract_id, link_id) WHERE link_id IS NOT NULL;
CREATE INDEX contract_items_by_device ON contract_items (organization_id, device_id) WHERE device_id IS NOT NULL;
CREATE INDEX contract_items_by_link ON contract_items (organization_id, link_id) WHERE link_id IS NOT NULL;

-- Files attached to contracts (scans, quotes). Kept in the database: one backup has everything; size capped by the API.
CREATE TABLE files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  contract_id      uuid NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  content_type     text NOT NULL CHECK (length(content_type) <= 100),
  size             integer NOT NULL CHECK (size > 0),
  sha256           bytea NOT NULL,
  data             bytea NOT NULL,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_contract_idx ON files (organization_id, contract_id);

-- Where a device was bought (the "vendor" column stays the manufacturer's name as printed on the box).
ALTER TABLE devices ADD COLUMN supplier_id uuid REFERENCES vendors (id) ON DELETE SET NULL;

-- Expiry alerts (ADR-043) for contracts too: a notification is about a device date or a contract end.
ALTER TABLE notifications ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE notifications ADD COLUMN contract_id uuid REFERENCES contracts (id) ON DELETE CASCADE;
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('warranty', 'license', 'eos', 'contract'));
ALTER TABLE notifications ADD CONSTRAINT notifications_subject_check
  CHECK ((kind = 'contract') = (contract_id IS NOT NULL) AND (device_id IS NULL) = (contract_id IS NOT NULL));
CREATE UNIQUE INDEX notifications_contract_once ON notifications (organization_id, contract_id, due_date, milestone)
  WHERE contract_id IS NOT NULL;
ALTER TABLE alert_settings DROP CONSTRAINT alert_settings_kinds_check;
ALTER TABLE alert_settings ADD CONSTRAINT alert_settings_kinds_check
  CHECK (kinds <@ ARRAY['warranty', 'license', 'eos', 'contract']::text[]);
ALTER TABLE alert_settings ALTER COLUMN kinds SET DEFAULT '{warranty,license,eos,contract}';
