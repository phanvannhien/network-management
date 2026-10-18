DELETE FROM notifications WHERE credential_id IS NOT NULL OR cloud_account_id IS NOT NULL;
UPDATE alert_settings SET kinds = array_remove(array_remove(kinds, 'credential'), 'cloud');
ALTER TABLE alert_settings ALTER COLUMN kinds SET DEFAULT '{warranty,license,eos,contract}';
ALTER TABLE alert_settings DROP CONSTRAINT alert_settings_kinds_check;
ALTER TABLE alert_settings ADD CONSTRAINT alert_settings_kinds_check
  CHECK (kinds <@ ARRAY['warranty', 'license', 'eos', 'contract']::text[]);
DROP INDEX notifications_cloud_once;
DROP INDEX notifications_credential_once;
ALTER TABLE notifications DROP CONSTRAINT notifications_subject_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_subject_check
  CHECK ((kind = 'contract') = (contract_id IS NOT NULL) AND (device_id IS NULL) = (contract_id IS NOT NULL));
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('warranty', 'license', 'eos', 'contract'));
ALTER TABLE notifications DROP COLUMN cloud_account_id;
ALTER TABLE notifications DROP COLUMN credential_id;
DROP TABLE cloud_account_devices;
DROP TABLE cloud_accounts;
DROP TABLE credential_devices;
DROP TABLE credentials;
