-- Expiry alerts (P2-05, ADR-043).

-- name: GetSmtpSettings :one
SELECT * FROM smtp_settings WHERE id = 1;

-- name: SaveSmtpSettings :one
-- keep_password leaves the stored password as it is; otherwise the given one (NULL clears it) replaces it.
INSERT INTO smtp_settings (id, host, port, security, username, password_ciphertext, password_wrapped_dek,
                           password_key_version, from_address, from_name, public_url, updated_by)
VALUES (1, @host, @port, @security, @username, sqlc.narg('password_ciphertext'), sqlc.narg('password_wrapped_dek'),
        sqlc.narg('password_key_version'), @from_address, @from_name, @public_url, @updated_by)
ON CONFLICT (id) DO UPDATE SET
  host = EXCLUDED.host, port = EXCLUDED.port, security = EXCLUDED.security, username = EXCLUDED.username,
  password_ciphertext = CASE WHEN @keep_password::boolean THEN smtp_settings.password_ciphertext ELSE EXCLUDED.password_ciphertext END,
  password_wrapped_dek = CASE WHEN @keep_password::boolean THEN smtp_settings.password_wrapped_dek ELSE EXCLUDED.password_wrapped_dek END,
  password_key_version = CASE WHEN @keep_password::boolean THEN smtp_settings.password_key_version ELSE EXCLUDED.password_key_version END,
  from_address = EXCLUDED.from_address, from_name = EXCLUDED.from_name, public_url = EXCLUDED.public_url,
  updated_by = EXCLUDED.updated_by, version = smtp_settings.version + 1
RETURNING *;

-- name: GetAlertSettings :one
SELECT * FROM alert_settings WHERE organization_id = @organization_id;

-- name: InsertAlertSettings :one
-- First save of an organization that still had the defaults (no row); nothing back = someone saved meanwhile.
INSERT INTO alert_settings (organization_id, enabled, kinds, milestones, email_admins, extra_emails)
VALUES (@organization_id, @enabled, @kinds::text[], @milestones::integer[], @email_admins, @extra_emails::text[])
ON CONFLICT (organization_id) DO NOTHING
RETURNING *;

-- name: UpdateAlertSettingsVersioned :one
UPDATE alert_settings SET enabled = @enabled, kinds = @kinds::text[], milestones = @milestones::integer[],
  email_admins = @email_admins, extra_emails = @extra_emails::text[], version = version + 1
WHERE organization_id = @organization_id AND version = @version
RETURNING *;

-- name: AlertOrganizations :many
-- Live organizations with their alert settings (defaults when they never saved any).
SELECT o.id, o.name, COALESCE(a.enabled, true)::boolean AS enabled,
       COALESCE(a.kinds, '{warranty,license,eos}')::text[] AS kinds,
       COALESCE(a.milestones, '{90,60,30,7}')::integer[] AS milestones,
       COALESCE(a.email_admins, true)::boolean AS email_admins,
       COALESCE(a.extra_emails, '{}')::text[] AS extra_emails,
       a.last_digest_on
FROM organizations o
LEFT JOIN alert_settings a ON a.organization_id = o.id
WHERE o.deleted_at IS NULL
ORDER BY o.id;

-- name: AlertCandidates :many
-- Dates of devices in use (or spare) of an organization up to @until; muted devices and retired / planned ones are
-- left out, like the dashboard's expiry block.
WITH dates AS (
  SELECT d.id, 'warranty'::text AS kind, d.warranty_end AS day FROM devices d
  WHERE d.organization_id = @organization_id AND d.warranty_end IS NOT NULL
  UNION ALL
  SELECT d.id, 'license', d.license_end FROM devices d
  WHERE d.organization_id = @organization_id AND d.license_end IS NOT NULL
  UNION ALL
  SELECT d.id, 'eos', d.eos_date FROM devices d
  WHERE d.organization_id = @organization_id AND d.eos_date IS NOT NULL
)
SELECT d.id AS device_id, dates.kind::text AS kind, dates.day::date AS day
FROM dates
JOIN devices d ON d.id = dates.id
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE d.deleted_at IS NULL AND d.lifecycle IN ('active', 'spare') AND NOT d.alerts_muted
  AND dates.day >= @since::date AND dates.day <= @until::date;

-- name: InsertNotification :one
INSERT INTO notifications (organization_id, kind, device_id, due_date, milestone)
VALUES (@organization_id, @kind, @device_id, @due_date, @milestone)
ON CONFLICT (organization_id, device_id, kind, due_date, milestone) DO NOTHING
RETURNING id;

-- name: UnsentNotifications :many
-- Notifications not e-mailed yet; current = the device still counts (date unchanged, not muted, still in use).
SELECT n.id, n.kind, n.due_date, n.milestone, d.id AS device_id, d.hostname, s.code::text AS site_code,
       (CASE n.kind WHEN 'warranty' THEN d.warranty_end WHEN 'license' THEN d.license_end ELSE d.eos_date END
          IS NOT DISTINCT FROM n.due_date
        AND NOT d.alerts_muted AND d.lifecycle IN ('active', 'spare'))::boolean AS current
FROM notifications n
JOIN devices d ON d.id = n.device_id AND d.deleted_at IS NULL
JOIN sites s ON s.id = d.site_id
WHERE n.organization_id = @organization_id AND n.emailed_at IS NULL
ORDER BY n.due_date, lower(d.hostname), n.kind;

-- name: MarkNotificationsEmailed :exec
UPDATE notifications SET emailed_at = now()
WHERE organization_id = @organization_id AND id = ANY (@ids::uuid[]);

-- name: SetAlertDigestDay :exec
INSERT INTO alert_settings AS a (organization_id, last_digest_on) VALUES (@organization_id, @day)
ON CONFLICT (organization_id) DO UPDATE SET last_digest_on = EXCLUDED.last_digest_on;

-- name: AlertAdminEmails :many
-- Owners and admins of the organization whose account is active.
SELECT u.email::text AS email
FROM memberships m
JOIN users u ON u.id = m.user_id AND u.disabled_at IS NULL
WHERE m.organization_id = @organization_id AND m.role IN ('owner', 'admin')
ORDER BY lower(u.email::text);

-- name: ListNotifications :many
-- The latest notifications of an organization for the bell (the caller filters them by device visibility).
SELECT n.id, n.kind, n.due_date, n.milestone, n.created_at, d.id AS device_id, d.hostname, s.code::text AS site_code
FROM notifications n
JOIN devices d ON d.id = n.device_id AND d.deleted_at IS NULL
JOIN sites s ON s.id = d.site_id AND s.deleted_at IS NULL
WHERE n.organization_id = @organization_id
ORDER BY n.created_at DESC, n.due_date
LIMIT @lim;

-- name: GetNotificationsSeen :one
SELECT seen_at FROM notification_reads WHERE organization_id = @organization_id AND user_id = @user_id;

-- name: MarkNotificationsSeen :exec
INSERT INTO notification_reads (organization_id, user_id, seen_at) VALUES (@organization_id, @user_id, now())
ON CONFLICT (organization_id, user_id) DO UPDATE SET seen_at = now();

-- name: SetDeviceAlertsMuted :execrows
UPDATE devices SET alerts_muted = @muted, version = version + 1
WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL;
