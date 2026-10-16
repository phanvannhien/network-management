-- One-time account links (P1-04): invitations for new users and password resets issued by a system admin.
-- Delivered out of band (no SMTP until P2-05). Only the SHA-256 of the token is stored.
CREATE TABLE user_tokens (
  token_hash  bytea PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('invite', 'password_reset')),
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_tokens_user_id_idx ON user_tokens (user_id);

-- Invited users have no password until they accept (empty hash never verifies; login treats it as invalid).
