-- Foundation tables: tenancy, identity, sessions, audit (SRS §10, §13; ADR-016, ADR-019).
-- Business tables added later always carry organization_id, created_at, updated_at, version.

CREATE EXTENSION IF NOT EXISTS citext;

-- Keeps updated_at current on every UPDATE; version is bumped by the application (optimistic lock).
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  kind        text NOT NULL DEFAULT 'internal' CHECK (kind IN ('internal', 'customer')),
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1
);
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Users are global identities; access to an organization is granted through memberships.
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext NOT NULL UNIQUE,
  display_name        text NOT NULL DEFAULT '',
  password_hash       text NOT NULL,               -- argon2id (P1-01)
  is_system_admin     boolean NOT NULL DEFAULT false,
  failed_login_count  integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  disabled_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE memberships (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  -- Extra grants: credential.reveal, credential.manage, user.manage (ADR-019).
  permissions      text[] NOT NULL DEFAULT '{}'
                   CHECK (permissions <@ ARRAY['credential.reveal', 'credential.manage', 'user.manage']::text[]),
  -- NULL = all sites; otherwise the membership is limited to these site ids (sites table arrives in P1-07).
  site_scope       uuid[],
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, user_id)
);
CREATE INDEX memberships_user_id_idx ON memberships (user_id);
CREATE TRIGGER memberships_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Server-side sessions; only a hash of the cookie token is stored.
CREATE TABLE sessions (
  token_hash              bytea PRIMARY KEY,
  user_id                 uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  active_organization_id  uuid REFERENCES organizations (id) ON DELETE SET NULL,
  mfa_verified_at         timestamptz,
  ip                      inet,
  user_agent              text NOT NULL DEFAULT '',
  created_at              timestamptz NOT NULL DEFAULT now(),
  last_seen_at            timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- Append-only audit trail. organization_id is NULL for system-level events (e.g. login, org creation).
-- Secrets never go into before/after (CLAUDE.md).
CREATE TABLE audit_log (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  uuid REFERENCES organizations (id) ON DELETE SET NULL,
  actor_user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  action           text NOT NULL,          -- e.g. device.update, auth.login, credential.reveal
  object_type      text NOT NULL DEFAULT '',
  object_id        text NOT NULL DEFAULT '',
  before           jsonb,
  after            jsonb,
  ip               inet,
  user_agent       text NOT NULL DEFAULT '',
  request_id       text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_created_idx ON audit_log (organization_id, created_at DESC);
CREATE INDEX audit_log_object_idx ON audit_log (object_type, object_id);

-- Enforce append-only at the database level.
CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
