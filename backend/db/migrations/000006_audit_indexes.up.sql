-- P1-05: audit log screens filter by time (system-level rows have no organization) and by actor.
CREATE INDEX audit_log_system_created_idx ON audit_log (created_at DESC, id DESC) WHERE organization_id IS NULL;
CREATE INDEX audit_log_actor_created_idx ON audit_log (actor_user_id, created_at DESC);
