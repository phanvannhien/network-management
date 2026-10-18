-- Device credentials and cloud accounts (P2-02 / P2-03, ADR-045). Every query is scoped to @organization_id.
-- List / detail queries never select the secret columns; only the *Secret queries (reveal, rotation) do.

-- name: ListCredentials :many
SELECT c.id, c.name, c.kind, c.username, (c.secret_ciphertext IS NOT NULL)::boolean AS has_secret,
       c.rotate_days, c.last_rotated_on, c.notes, c.version, c.updated_at,
       (SELECT count(*) FROM credential_devices cd JOIN devices d ON d.id = cd.device_id AND d.deleted_at IS NULL
         WHERE cd.credential_id = c.id)::bigint AS device_count
FROM credentials c
WHERE c.organization_id = @organization_id AND c.deleted_at IS NULL
  AND (@q::text = '' OR c.name ILIKE '%' || @q || '%' OR c.username ILIKE '%' || @q || '%')
  AND (sqlc.narg('device_id')::uuid IS NULL OR EXISTS (
        SELECT 1 FROM credential_devices cd WHERE cd.credential_id = c.id AND cd.device_id = sqlc.narg('device_id')::uuid))
  AND (sqlc.narg('credential_id')::uuid IS NULL OR c.id = sqlc.narg('credential_id')::uuid)
ORDER BY lower(c.name);

-- name: GetCredentialMeta :one
SELECT id, name, kind, username, (secret_ciphertext IS NOT NULL)::boolean AS has_secret, rotate_days, last_rotated_on,
       notes, version
FROM credentials WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL;

-- name: GetCredentialSecret :one
SELECT id, name, secret_ciphertext, secret_wrapped_dek, secret_key_version
FROM credentials WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL;

-- name: CreateCredential :one
INSERT INTO credentials (id, organization_id, name, kind, username, secret_ciphertext, secret_wrapped_dek, secret_key_version,
                         rotate_days, last_rotated_on, notes)
VALUES (@id, @organization_id, @name, @kind, @username, sqlc.narg('secret_ciphertext'), sqlc.narg('secret_wrapped_dek'),
        sqlc.narg('secret_key_version'), sqlc.narg('rotate_days'), sqlc.narg('last_rotated_on'), @notes)
RETURNING id, version;

-- name: UpdateCredential :one
-- keep_secret leaves the stored secret; otherwise the given one (NULL clears it) replaces it.
UPDATE credentials SET name = @name, kind = @kind, username = @username,
  secret_ciphertext = CASE WHEN @keep_secret::boolean THEN secret_ciphertext ELSE sqlc.narg('secret_ciphertext') END,
  secret_wrapped_dek = CASE WHEN @keep_secret::boolean THEN secret_wrapped_dek ELSE sqlc.narg('secret_wrapped_dek') END,
  secret_key_version = CASE WHEN @keep_secret::boolean THEN secret_key_version ELSE sqlc.narg('secret_key_version') END,
  rotate_days = sqlc.narg('rotate_days'), last_rotated_on = sqlc.narg('last_rotated_on'), notes = @notes,
  version = version + 1
WHERE organization_id = @organization_id AND id = @id AND version = @version AND deleted_at IS NULL
RETURNING id, version;

-- name: SoftDeleteCredential :execrows
-- The secret is dropped with it: a deleted credential keeps no password.
UPDATE credentials SET deleted_at = now(), secret_ciphertext = NULL, secret_wrapped_dek = NULL, secret_key_version = NULL,
  version = version + 1
WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL;

-- name: CredentialDevices :many
SELECT cd.device_id, cd.purpose, d.hostname, s.code::text AS site_code, d.type
FROM credential_devices cd
JOIN devices d ON d.id = cd.device_id AND d.deleted_at IS NULL
JOIN sites s ON s.id = d.site_id
WHERE cd.organization_id = @organization_id AND cd.credential_id = @credential_id
ORDER BY lower(d.hostname);

-- name: DeleteCredentialDevices :exec
DELETE FROM credential_devices WHERE organization_id = @organization_id AND credential_id = @credential_id;

-- name: AddCredentialDevices :exec
INSERT INTO credential_devices (organization_id, credential_id, device_id, purpose)
SELECT @organization_id, @credential_id, p.device_id, p.purpose
FROM (SELECT unnest(@device_ids::uuid[]) AS device_id, unnest(@purposes::text[]) AS purpose) p
WHERE EXISTS (SELECT 1 FROM devices d WHERE d.id = p.device_id AND d.organization_id = @organization_id AND d.deleted_at IS NULL)
ON CONFLICT DO NOTHING;

-- name: CountLiveDevicesIn :one
SELECT count(*) FROM devices WHERE organization_id = @organization_id AND id = ANY (@ids::uuid[]) AND deleted_at IS NULL;

-- name: ListCloudAccounts :many
SELECT a.id, a.provider, a.name, a.portal_url, a.username, (a.secret_ciphertext IS NOT NULL)::boolean AS has_secret,
       a.mfa_holder, a.plan, a.expires_on, a.vendor_id, COALESCE(v.name, '')::text AS vendor_name, a.notes, a.version,
       (SELECT count(*) FROM cloud_account_devices cd JOIN devices d ON d.id = cd.device_id AND d.deleted_at IS NULL
         WHERE cd.cloud_account_id = a.id)::bigint AS device_count
FROM cloud_accounts a
LEFT JOIN vendors v ON v.id = a.vendor_id AND v.organization_id = a.organization_id AND v.deleted_at IS NULL
WHERE a.organization_id = @organization_id AND a.deleted_at IS NULL
  AND (@q::text = '' OR a.name ILIKE '%' || @q || '%' OR a.username ILIKE '%' || @q || '%' OR a.mfa_holder ILIKE '%' || @q || '%')
  AND (sqlc.narg('device_id')::uuid IS NULL OR EXISTS (
        SELECT 1 FROM cloud_account_devices cd WHERE cd.cloud_account_id = a.id AND cd.device_id = sqlc.narg('device_id')::uuid))
  AND (sqlc.narg('account_id')::uuid IS NULL OR a.id = sqlc.narg('account_id')::uuid)
ORDER BY lower(a.name);

-- name: GetCloudAccountMeta :one
SELECT id, provider, name, portal_url, username, mfa_holder, plan, expires_on, vendor_id, notes, version
FROM cloud_accounts WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL;

-- name: GetCloudAccountSecret :one
SELECT id, name, secret_ciphertext, secret_wrapped_dek, secret_key_version
FROM cloud_accounts WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL;

-- name: CreateCloudAccount :one
INSERT INTO cloud_accounts (id, organization_id, provider, name, portal_url, username, secret_ciphertext, secret_wrapped_dek,
                            secret_key_version, mfa_holder, plan, expires_on, vendor_id, notes)
VALUES (@id, @organization_id, @provider, @name, @portal_url, @username, sqlc.narg('secret_ciphertext'),
        sqlc.narg('secret_wrapped_dek'), sqlc.narg('secret_key_version'), @mfa_holder, @plan, sqlc.narg('expires_on'),
        sqlc.narg('vendor_id'), @notes)
RETURNING id, version;

-- name: UpdateCloudAccount :one
UPDATE cloud_accounts SET provider = @provider, name = @name, portal_url = @portal_url, username = @username,
  secret_ciphertext = CASE WHEN @keep_secret::boolean THEN secret_ciphertext ELSE sqlc.narg('secret_ciphertext') END,
  secret_wrapped_dek = CASE WHEN @keep_secret::boolean THEN secret_wrapped_dek ELSE sqlc.narg('secret_wrapped_dek') END,
  secret_key_version = CASE WHEN @keep_secret::boolean THEN secret_key_version ELSE sqlc.narg('secret_key_version') END,
  mfa_holder = @mfa_holder, plan = @plan, expires_on = sqlc.narg('expires_on'), vendor_id = sqlc.narg('vendor_id'),
  notes = @notes, version = version + 1
WHERE organization_id = @organization_id AND id = @id AND version = @version AND deleted_at IS NULL
RETURNING id, version;

-- name: SoftDeleteCloudAccount :execrows
UPDATE cloud_accounts SET deleted_at = now(), secret_ciphertext = NULL, secret_wrapped_dek = NULL, secret_key_version = NULL,
  version = version + 1
WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL;

-- name: CloudAccountDevices :many
SELECT cd.device_id, d.hostname, s.code::text AS site_code, d.type
FROM cloud_account_devices cd
JOIN devices d ON d.id = cd.device_id AND d.deleted_at IS NULL
JOIN sites s ON s.id = d.site_id
WHERE cd.organization_id = @organization_id AND cd.cloud_account_id = @cloud_account_id
ORDER BY lower(d.hostname);

-- name: DeleteCloudAccountDevices :exec
DELETE FROM cloud_account_devices WHERE organization_id = @organization_id AND cloud_account_id = @cloud_account_id;

-- name: AddCloudAccountDevices :exec
INSERT INTO cloud_account_devices (organization_id, cloud_account_id, device_id)
SELECT @organization_id, @cloud_account_id, d.id
FROM devices d WHERE d.organization_id = @organization_id AND d.id = ANY (@device_ids::uuid[]) AND d.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- Master key rotation (ntb rotate-master-key): every stored secret of the installation, across organizations.

-- name: AllSealedCredentials :many
SELECT id, secret_ciphertext, secret_wrapped_dek, secret_key_version FROM credentials WHERE secret_ciphertext IS NOT NULL;

-- name: RewrapCredential :execrows
UPDATE credentials SET secret_wrapped_dek = @secret_wrapped_dek, secret_key_version = @secret_key_version
WHERE id = @id AND secret_wrapped_dek = @old_wrapped_dek;

-- name: AllSealedCloudAccounts :many
SELECT id, secret_ciphertext, secret_wrapped_dek, secret_key_version FROM cloud_accounts WHERE secret_ciphertext IS NOT NULL;

-- name: RewrapCloudAccount :execrows
UPDATE cloud_accounts SET secret_wrapped_dek = @secret_wrapped_dek, secret_key_version = @secret_key_version
WHERE id = @id AND secret_wrapped_dek = @old_wrapped_dek;

-- name: AllSealedTOTP :many
SELECT user_id, secret_ciphertext, wrapped_dek, key_version FROM mfa_totp;

-- name: RewrapTOTP :execrows
UPDATE mfa_totp SET wrapped_dek = @wrapped_dek, key_version = @key_version
WHERE user_id = @user_id AND wrapped_dek = @old_wrapped_dek;

-- name: SealedSmtpPassword :many
SELECT password_ciphertext, password_wrapped_dek, password_key_version FROM smtp_settings WHERE password_ciphertext IS NOT NULL;

-- name: RewrapSmtpPassword :execrows
UPDATE smtp_settings SET password_wrapped_dek = @password_wrapped_dek, password_key_version = @password_key_version
WHERE id = 1 AND password_wrapped_dek = @old_wrapped_dek;

-- name: SecretKeyVersions :many
-- Master key versions in use, across every table holding a sealed secret (startup check, rotation).
SELECT DISTINCT v::smallint AS version FROM (
  SELECT secret_key_version AS v FROM credentials WHERE secret_key_version IS NOT NULL
  UNION SELECT secret_key_version FROM cloud_accounts WHERE secret_key_version IS NOT NULL
  UNION SELECT key_version FROM mfa_totp WHERE secret_ciphertext <> '\x00'::bytea
  UNION SELECT password_key_version FROM smtp_settings WHERE password_key_version IS NOT NULL
) x ORDER BY 1;
