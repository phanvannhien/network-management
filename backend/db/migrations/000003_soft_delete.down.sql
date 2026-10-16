ALTER TABLE organizations DROP COLUMN IF EXISTS deleted_at;

ALTER TABLE audit_log
  DROP CONSTRAINT audit_log_actor_user_id_fkey,
  ADD CONSTRAINT audit_log_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE audit_log
  DROP CONSTRAINT audit_log_organization_id_fkey,
  ADD CONSTRAINT audit_log_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL;
