-- TOTP MFA (P1-02, SRS §10, ADR-019). The seed is envelope-encrypted (internal/secrets); only
-- ciphertext + wrapped data key + master-key version are stored.
CREATE TABLE mfa_totp (
  user_id            uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret_ciphertext  bytea NOT NULL,
  wrapped_dek        bytea NOT NULL,
  key_version        smallint NOT NULL,
  enabled_at         timestamptz,            -- NULL = enrollment started but not confirmed
  last_used_step     bigint NOT NULL DEFAULT 0, -- replay protection: a TOTP time step is accepted once
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER mfa_totp_updated_at BEFORE UPDATE ON mfa_totp
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One-time recovery codes; only SHA-256 hashes are stored (codes are high-entropy random strings).
CREATE TABLE mfa_recovery_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash   bytea NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);
