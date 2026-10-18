-- P2-05 (ADR-043): expiry alerts — e-mail via one SMTP server for the whole installation, in-app notifications.

-- System settings for outgoing mail: a single row (id = 1), edited by system admins. The password is
-- envelope-encrypted (internal/secrets); only ciphertext + wrapped data key + master-key version are stored.
CREATE TABLE smtp_settings (
  id                   smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  host                 text NOT NULL DEFAULT '' CHECK (length(host) <= 253),
  port                 integer NOT NULL DEFAULT 587 CHECK (port BETWEEN 1 AND 65535),
  security             text NOT NULL DEFAULT 'starttls' CHECK (security IN ('starttls', 'tls', 'none')),
  username             text NOT NULL DEFAULT '' CHECK (length(username) <= 320),
  password_ciphertext  bytea,
  password_wrapped_dek bytea,
  password_key_version smallint,
  from_address         text NOT NULL DEFAULT '' CHECK (length(from_address) <= 320),
  from_name            text NOT NULL DEFAULT '' CHECK (length(from_name) <= 200),
  -- Address users open the system at, for links in e-mails (https://ntb.example.com).
  public_url           text NOT NULL DEFAULT '' CHECK (length(public_url) <= 300),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES users (id) ON DELETE SET NULL,
  version              integer NOT NULL DEFAULT 1,
  CHECK ((password_ciphertext IS NULL) = (password_wrapped_dek IS NULL))
);
CREATE TRIGGER smtp_settings_updated_at BEFORE UPDATE ON smtp_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What an organization is warned about, how early, and who gets the e-mail. No row = the defaults.
CREATE TABLE alert_settings (
  organization_id  uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  enabled          boolean NOT NULL DEFAULT true,
  kinds            text[] NOT NULL DEFAULT '{warranty,license,eos}'
                   CHECK (kinds <@ ARRAY['warranty', 'license', 'eos']::text[]),
  -- Days before the date; each one is announced once per date.
  milestones       integer[] NOT NULL DEFAULT '{90,60,30,7}'
                   CHECK (cardinality(milestones) BETWEEN 1 AND 6 AND 0 < ALL (milestones) AND 366 > ALL (milestones)),
  email_admins     boolean NOT NULL DEFAULT true,   -- owners and admins of the organization
  extra_emails     text[] NOT NULL DEFAULT '{}' CHECK (cardinality(extra_emails) <= 20),
  last_digest_on   date,                            -- one digest e-mail a day at most
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1
);
CREATE TRIGGER alert_settings_updated_at BEFORE UPDATE ON alert_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per date reaching a milestone (milestone 0 = the date has passed). The unique key makes each one
-- announced once; a renewed date is a new date, so it starts over.
CREATE TABLE notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('warranty', 'license', 'eos')),
  device_id        uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  due_date         date NOT NULL,
  milestone        integer NOT NULL CHECK (milestone >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  emailed_at       timestamptz,
  UNIQUE (organization_id, device_id, kind, due_date, milestone)
);
CREATE INDEX notifications_org_created ON notifications (organization_id, created_at DESC);
CREATE INDEX notifications_unsent ON notifications (organization_id) WHERE emailed_at IS NULL;

-- When each member last opened the bell: newer notifications are unread.
CREATE TABLE notification_reads (
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  seen_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

-- A device whose dates should not raise alerts (being replaced, known).
ALTER TABLE devices ADD COLUMN alerts_muted boolean NOT NULL DEFAULT false;
