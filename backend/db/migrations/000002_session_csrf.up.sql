-- Per-session CSRF token (P1-01). Not a secret on its own: it only works together with the
-- HttpOnly session cookie, so it is stored as-is and echoed to the client on login and /auth/me.
ALTER TABLE sessions ADD COLUMN csrf_token text NOT NULL DEFAULT '';
ALTER TABLE sessions ALTER COLUMN csrf_token DROP DEFAULT;
