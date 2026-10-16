-- ADR-022: users and organizations are soft-deleted; audit rows block hard deletes with a clear FK error.
-- (The old ON DELETE SET NULL tried to UPDATE audit_log, which the append-only trigger rejects.)

ALTER TABLE audit_log
  DROP CONSTRAINT audit_log_organization_id_fkey,
  ADD CONSTRAINT audit_log_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT;

ALTER TABLE audit_log
  DROP CONSTRAINT audit_log_actor_user_id_fkey,
  ADD CONSTRAINT audit_log_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT;

-- Soft delete for organizations (users already have disabled_at).
ALTER TABLE organizations ADD COLUMN deleted_at timestamptz;
