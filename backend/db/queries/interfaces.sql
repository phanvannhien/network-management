-- Templates, interfaces and IP addresses (P1-09, ADR-012). Every query takes organization_id; interface / IP queries
-- also take the device, which the API has already checked for visibility.

-- name: ListDeviceTemplates :many
SELECT * FROM device_templates WHERE organization_id = @organization_id ORDER BY lower(name);

-- name: GetDeviceTemplate :one
SELECT * FROM device_templates WHERE id = @id AND organization_id = @organization_id;

-- name: CreateDeviceTemplate :one
INSERT INTO device_templates (organization_id, name, type, vendor, model, part_number, u_height, ports, notes)
VALUES (@organization_id, @name, @type, @vendor, @model, @part_number, @u_height, @ports, @notes)
RETURNING *;

-- name: UpdateDeviceTemplate :one
UPDATE device_templates SET name = @name, type = @type, vendor = @vendor, model = @model, part_number = @part_number,
  u_height = @u_height, ports = @ports, notes = @notes, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND version = @version
RETURNING *;

-- name: DeleteDeviceTemplate :execrows
DELETE FROM device_templates WHERE id = @id AND organization_id = @organization_id;

-- name: ListInterfaces :many
SELECT i.*, COALESCE(lag.name, '')::text AS lag_name
FROM interfaces i
LEFT JOIN interfaces lag ON lag.id = i.lag_id
WHERE i.organization_id = @organization_id AND i.device_id = @device_id
ORDER BY i.sort_order, i.name;

-- name: GetInterface :one
SELECT * FROM interfaces WHERE id = @id AND organization_id = @organization_id AND device_id = @device_id;

-- name: MaxInterfaceSort :one
SELECT COALESCE(max(sort_order), 0)::integer FROM interfaces WHERE organization_id = @organization_id AND device_id = @device_id;

-- name: CreateInterface :one
INSERT INTO interfaces (organization_id, device_id, name, kind, media, speed, duplex, mode, access_vlan, native_vlan,
                        allowed_vlans, poe, lag_id, description, admin_up, sort_order, mac, vlan_tag)
VALUES (@organization_id, @device_id, @name, @kind, @media, @speed, @duplex, @mode, sqlc.narg('access_vlan'),
        sqlc.narg('native_vlan'), @allowed_vlans, @poe, sqlc.narg('lag_id'), @description, @admin_up, @sort_order,
        sqlc.narg('mac'), sqlc.narg('vlan_tag'))
RETURNING *;

-- name: CreateInterfaceIfMissing :execrows
-- Applying a template adds the ports a device does not have yet (by name, case-insensitive).
INSERT INTO interfaces (organization_id, device_id, name, kind, media, speed, poe, sort_order)
VALUES (@organization_id, @device_id, @name, 'physical', @media, @speed, @poe, @sort_order)
ON CONFLICT (device_id, lower(name)) DO NOTHING;

-- name: UpdateInterface :one
UPDATE interfaces SET name = @name, kind = @kind, media = @media, speed = @speed, duplex = @duplex, mode = @mode,
  access_vlan = sqlc.narg('access_vlan'), native_vlan = sqlc.narg('native_vlan'), allowed_vlans = @allowed_vlans,
  poe = @poe, lag_id = sqlc.narg('lag_id'), description = @description, admin_up = @admin_up, mac = sqlc.narg('mac'),
  vlan_tag = sqlc.narg('vlan_tag'), version = version + 1
WHERE id = @id AND organization_id = @organization_id AND device_id = @device_id AND version = @version
RETURNING *;

-- name: DeleteInterface :execrows
DELETE FROM interfaces WHERE id = @id AND organization_id = @organization_id AND device_id = @device_id;

-- name: ListDeviceIPs :many
SELECT ip.*, COALESCE(i.name, '')::text AS interface_name
FROM ip_addresses ip
LEFT JOIN interfaces i ON i.id = ip.interface_id
WHERE ip.organization_id = @organization_id AND ip.device_id = @device_id
ORDER BY i.sort_order NULLS LAST, i.name, family(ip.address), ip.address;

-- name: GetIP :one
SELECT * FROM ip_addresses WHERE id = @id AND organization_id = @organization_id AND device_id = @device_id;

-- name: CreateIP :one
INSERT INTO ip_addresses (organization_id, device_id, interface_id, address, vrf, role, description)
VALUES (@organization_id, @device_id, sqlc.narg('interface_id'), @address, @vrf, @role, @description)
RETURNING *;

-- name: UpdateIP :one
UPDATE ip_addresses SET interface_id = sqlc.narg('interface_id'), address = @address, vrf = @vrf, role = @role,
  description = @description, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND device_id = @device_id AND version = @version
RETURNING *;

-- name: DeleteIP :execrows
DELETE FROM ip_addresses WHERE id = @id AND organization_id = @organization_id AND device_id = @device_id;

-- name: CountInterfaceIPs :one
SELECT count(*) FROM ip_addresses WHERE organization_id = @organization_id AND interface_id = @interface_id;
