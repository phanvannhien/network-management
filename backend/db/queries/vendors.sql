-- Vendors, contacts, contracts, contract files (P2-04, ADR-044). Every query is scoped to @organization_id.

-- name: ListVendors :many
SELECT v.*,
       (SELECT count(*) FROM vendor_contacts c WHERE c.vendor_id = v.id AND c.organization_id = v.organization_id)::bigint AS contact_count,
       (SELECT count(*) FROM contracts k WHERE k.vendor_id = v.id AND k.organization_id = v.organization_id AND k.deleted_at IS NULL)::bigint AS contract_count,
       (SELECT min(k.end_date) FROM contracts k
         WHERE k.vendor_id = v.id AND k.deleted_at IS NULL AND k.end_date >= @today::date)::date AS next_end
FROM vendors v
WHERE v.organization_id = @organization_id AND v.deleted_at IS NULL
  AND (@kind::text = '' OR v.kind = @kind)
  AND (@q::text = '' OR v.name ILIKE '%' || @q || '%' OR v.tax_code ILIKE '%' || @q || '%')
ORDER BY lower(v.name);

-- name: GetVendor :one
SELECT * FROM vendors WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL;

-- name: CreateVendor :one
INSERT INTO vendors (organization_id, kind, name, tax_code, website, support_phone, support_email, support_portal, notes)
VALUES (@organization_id, @kind, @name, @tax_code, @website, @support_phone, @support_email, @support_portal, @notes)
RETURNING *;

-- name: UpdateVendor :one
UPDATE vendors SET kind = @kind, name = @name, tax_code = @tax_code, website = @website, support_phone = @support_phone,
  support_email = @support_email, support_portal = @support_portal, notes = @notes, version = version + 1
WHERE organization_id = @organization_id AND id = @id AND version = @version AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteVendor :execrows
UPDATE vendors SET deleted_at = now(), version = version + 1
WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL;

-- name: CountLiveContractsOfVendor :one
SELECT count(*) FROM contracts WHERE organization_id = @organization_id AND vendor_id = @vendor_id AND deleted_at IS NULL;

-- name: ClearDeviceSupplier :exec
UPDATE devices SET supplier_id = NULL WHERE organization_id = @organization_id AND supplier_id = @supplier_id;

-- name: ListVendorContacts :many
SELECT * FROM vendor_contacts WHERE organization_id = @organization_id AND vendor_id = @vendor_id ORDER BY lower(name);

-- name: ListContactsOfVendors :many
SELECT * FROM vendor_contacts WHERE organization_id = @organization_id AND vendor_id = ANY (@vendor_ids::uuid[])
ORDER BY lower(name);

-- name: GetVendorContact :one
SELECT * FROM vendor_contacts WHERE organization_id = @organization_id AND id = @id;

-- name: CreateVendorContact :one
INSERT INTO vendor_contacts (organization_id, vendor_id, name, title, phone, email, notes)
VALUES (@organization_id, @vendor_id, @name, @title, @phone, @email, @notes)
RETURNING *;

-- name: UpdateVendorContact :one
UPDATE vendor_contacts SET name = @name, title = @title, phone = @phone, email = @email, notes = @notes, version = version + 1
WHERE organization_id = @organization_id AND id = @id AND version = @version
RETURNING *;

-- name: DeleteVendorContact :execrows
DELETE FROM vendor_contacts WHERE organization_id = @organization_id AND id = @id;

-- name: ListContracts :many
-- Live contracts, optionally of one vendor / covering one device or link / ending by a date.
SELECT k.*, v.name AS vendor_name, v.kind AS vendor_kind, v.support_phone, v.support_email, v.support_portal,
       (SELECT count(*) FROM contract_items i WHERE i.contract_id = k.id AND i.organization_id = k.organization_id AND i.device_id IS NOT NULL)::bigint AS device_count,
       (SELECT count(*) FROM contract_items i WHERE i.contract_id = k.id AND i.organization_id = k.organization_id AND i.link_id IS NOT NULL)::bigint AS link_count,
       (SELECT count(*) FROM files f WHERE f.contract_id = k.id)::bigint AS file_count
FROM contracts k
JOIN vendors v ON v.id = k.vendor_id AND v.organization_id = k.organization_id
WHERE k.organization_id = @organization_id AND k.deleted_at IS NULL
  AND (sqlc.narg('contract_id')::uuid IS NULL OR k.id = sqlc.narg('contract_id')::uuid)
  AND (sqlc.narg('vendor_id')::uuid IS NULL OR k.vendor_id = sqlc.narg('vendor_id')::uuid)
  AND (sqlc.narg('device_id')::uuid IS NULL OR EXISTS (
        SELECT 1 FROM contract_items i WHERE i.contract_id = k.id AND i.device_id = sqlc.narg('device_id')::uuid))
  AND (sqlc.narg('link_id')::uuid IS NULL OR EXISTS (
        SELECT 1 FROM contract_items i WHERE i.contract_id = k.id AND i.link_id = sqlc.narg('link_id')::uuid))
  AND (sqlc.narg('ends_before')::date IS NULL OR k.end_date < sqlc.narg('ends_before')::date)
  AND (@q::text = '' OR k.name ILIKE '%' || @q || '%' OR k.number ILIKE '%' || @q || '%' OR v.name ILIKE '%' || @q || '%')
ORDER BY k.end_date NULLS LAST, lower(k.name);

-- name: GetContract :one
SELECT * FROM contracts WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL;

-- name: CreateContract :one
INSERT INTO contracts (organization_id, vendor_id, kind, number, name, start_date, end_date, sla, notes)
VALUES (@organization_id, @vendor_id, @kind, @number, @name, sqlc.narg('start_date'), sqlc.narg('end_date'), @sla, @notes)
RETURNING *;

-- name: UpdateContract :one
UPDATE contracts SET vendor_id = @vendor_id, kind = @kind, number = @number, name = @name,
  start_date = sqlc.narg('start_date'), end_date = sqlc.narg('end_date'), sla = @sla, notes = @notes, version = version + 1
WHERE organization_id = @organization_id AND id = @id AND version = @version AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteContract :execrows
UPDATE contracts SET deleted_at = now(), version = version + 1
WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL;

-- name: ContractItems :many
SELECT device_id, link_id FROM contract_items WHERE organization_id = @organization_id AND contract_id = @contract_id;

-- name: DeleteContractItems :exec
DELETE FROM contract_items WHERE organization_id = @organization_id AND contract_id = @contract_id;

-- name: AddContractDevices :exec
INSERT INTO contract_items (organization_id, contract_id, device_id)
SELECT @organization_id, @contract_id, unnest(@device_ids::uuid[])
ON CONFLICT DO NOTHING;

-- name: AddContractLinks :exec
INSERT INTO contract_items (organization_id, contract_id, link_id)
SELECT @organization_id, @contract_id, unnest(@link_ids::uuid[])
ON CONFLICT DO NOTHING;

-- name: CountLinksInOrg :one
SELECT count(*) FROM links WHERE organization_id = @organization_id AND id = ANY (@ids::uuid[]);

-- name: DeleteContractFiles :many
DELETE FROM files WHERE organization_id = @organization_id AND contract_id = @contract_id RETURNING id, name;

-- name: LockContract :one
SELECT id FROM contracts WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL FOR UPDATE;

-- name: ListContractFiles :many
SELECT id, contract_id, name, content_type, size, created_at, created_by
FROM files WHERE organization_id = @organization_id AND contract_id = @contract_id ORDER BY created_at;

-- name: CreateFile :one
INSERT INTO files (organization_id, contract_id, name, content_type, size, sha256, data, created_by)
VALUES (@organization_id, @contract_id, @name, @content_type, @size, @sha256, @data, @created_by)
RETURNING id, contract_id, name, content_type, size, created_at, created_by;

-- name: GetFile :one
-- The file and its contract, live.
SELECT f.* FROM files f JOIN contracts k ON k.id = f.contract_id AND k.organization_id = f.organization_id AND k.deleted_at IS NULL
WHERE f.organization_id = @organization_id AND f.id = @id;

-- name: GetFileMeta :one
SELECT f.id, f.contract_id, f.name, f.size FROM files f JOIN contracts k ON k.id = f.contract_id AND k.organization_id = f.organization_id AND k.deleted_at IS NULL
WHERE f.organization_id = @organization_id AND f.id = @id;

-- name: DeleteFile :execrows
DELETE FROM files WHERE organization_id = @organization_id AND id = @id;

-- name: CountContractFiles :one
SELECT count(*) FROM files WHERE organization_id = @organization_id AND contract_id = @contract_id;

-- name: SetDeviceSupplier :execrows
UPDATE devices SET supplier_id = sqlc.narg('supplier_id'), version = version + 1
WHERE organization_id = @organization_id AND id = @id AND deleted_at IS NULL;
