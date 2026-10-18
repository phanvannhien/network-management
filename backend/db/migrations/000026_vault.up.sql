-- P2-02 / P2-03 (ADR-045): device credentials and cloud management accounts. Secrets are envelope-encrypted
-- (internal/secrets, AAD bound to the row id); only ciphertext + wrapped data key + master-key version are stored.

CREATE TABLE credentials (
  id                   uuid PRIMARY KEY,               -- given by the API: part of the secret's AAD
  organization_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name                 text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  kind                 text NOT NULL CHECK (kind IN ('ssh', 'telnet', 'web', 'console', 'enable', 'snmp', 'api', 'other')),
  username             text NOT NULL DEFAULT '' CHECK (length(username) <= 200),
  secret_ciphertext    bytea,
  secret_wrapped_dek   bytea,
  secret_key_version   smallint,
  rotate_days          integer CHECK (rotate_days IS NULL OR rotate_days BETWEEN 1 AND 3650),
  last_rotated_on      date,
  notes                text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  deleted_at           timestamptz,
  CHECK ((secret_ciphertext IS NULL) = (secret_wrapped_dek IS NULL) AND (secret_ciphertext IS NULL) = (secret_key_version IS NULL))
);
CREATE UNIQUE INDEX credentials_org_name_live_idx ON credentials (organization_id, lower(name)) WHERE deleted_at IS NULL;
CREATE TRIGGER credentials_updated_at BEFORE UPDATE ON credentials FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Which devices use a credential, and for what (ssh, web, console…).
CREATE TABLE credential_devices (
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  credential_id    uuid NOT NULL REFERENCES credentials (id) ON DELETE CASCADE,
  device_id        uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  purpose          text NOT NULL DEFAULT '' CHECK (length(purpose) <= 50),
  PRIMARY KEY (credential_id, device_id)
);
CREATE INDEX credential_devices_by_device ON credential_devices (organization_id, device_id);

CREATE TABLE cloud_accounts (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  provider             text NOT NULL CHECK (provider IN ('forticloud', 'meraki', 'unifi', 'omada', 'aruba_central', 'hik_connect', 'other')),
  name                 text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  portal_url           text NOT NULL DEFAULT '' CHECK (length(portal_url) <= 300),
  username             text NOT NULL DEFAULT '' CHECK (length(username) <= 320),
  secret_ciphertext    bytea,
  secret_wrapped_dek   bytea,
  secret_key_version   smallint,
  mfa_holder           text NOT NULL DEFAULT '' CHECK (length(mfa_holder) <= 200),
  plan                 text NOT NULL DEFAULT '' CHECK (length(plan) <= 200),
  expires_on           date,
  vendor_id            uuid REFERENCES vendors (id) ON DELETE SET NULL,
  notes                text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  deleted_at           timestamptz,
  CHECK ((secret_ciphertext IS NULL) = (secret_wrapped_dek IS NULL) AND (secret_ciphertext IS NULL) = (secret_key_version IS NULL))
);
CREATE UNIQUE INDEX cloud_accounts_org_name_live_idx ON cloud_accounts (organization_id, lower(name)) WHERE deleted_at IS NULL;
CREATE TRIGGER cloud_accounts_updated_at BEFORE UPDATE ON cloud_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cloud_account_devices (
  organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  cloud_account_id  uuid NOT NULL REFERENCES cloud_accounts (id) ON DELETE CASCADE,
  device_id         uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  PRIMARY KEY (cloud_account_id, device_id)
);
CREATE INDEX cloud_account_devices_by_device ON cloud_account_devices (organization_id, device_id);

-- Expiry alerts (ADR-043): a credential due for change, a cloud account ending.
ALTER TABLE notifications ADD COLUMN credential_id uuid REFERENCES credentials (id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN cloud_account_id uuid REFERENCES cloud_accounts (id) ON DELETE CASCADE;
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('warranty', 'license', 'eos', 'contract', 'credential', 'cloud'));
ALTER TABLE notifications DROP CONSTRAINT notifications_subject_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_subject_check CHECK (
  num_nonnulls(device_id, contract_id, credential_id, cloud_account_id) = 1
  AND (kind = 'contract') = (contract_id IS NOT NULL)
  AND (kind = 'credential') = (credential_id IS NOT NULL)
  AND (kind = 'cloud') = (cloud_account_id IS NOT NULL));
CREATE UNIQUE INDEX notifications_credential_once ON notifications (organization_id, credential_id, due_date, milestone)
  WHERE credential_id IS NOT NULL;
CREATE UNIQUE INDEX notifications_cloud_once ON notifications (organization_id, cloud_account_id, due_date, milestone)
  WHERE cloud_account_id IS NOT NULL;
ALTER TABLE alert_settings DROP CONSTRAINT alert_settings_kinds_check;
ALTER TABLE alert_settings ADD CONSTRAINT alert_settings_kinds_check
  CHECK (kinds <@ ARRAY['warranty', 'license', 'eos', 'contract', 'credential', 'cloud']::text[]);
ALTER TABLE alert_settings ALTER COLUMN kinds SET DEFAULT '{warranty,license,eos,contract,credential,cloud}';
