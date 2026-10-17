-- Device import (P1-21): lookups that place each spreadsheet row. Every query takes organization_id.

-- name: ImportDevicesByHostname :many
SELECT id FROM devices
WHERE organization_id = @organization_id AND deleted_at IS NULL AND type <> 'provider_cloud'
  AND lower(hostname) = lower(@hostname)
LIMIT 2;

-- name: ImportDevicesBySerial :many
SELECT id FROM devices
WHERE organization_id = @organization_id AND deleted_at IS NULL AND btrim(serial_number) <> ''
  AND lower(btrim(serial_number)) = lower(btrim(@serial::text))
  AND lower(btrim(@serial::text)) NOT IN ('-', 'n/a', 'na', 'none', 'unknown', 'tbd', '0')
LIMIT 2;

-- name: ImportClusterByName :one
SELECT id, site_id FROM device_clusters
WHERE organization_id = @organization_id AND lower(name) = lower(@name);

-- name: ImportInterfaceByName :one
SELECT id FROM interfaces
WHERE organization_id = @organization_id AND device_id = @device_id AND lower(name) = lower(@name);

-- name: ImportSubnetPrefix :one
-- Prefix length of the most specific subnet holding the address in the VRF (0 = none).
SELECT COALESCE(max(masklen(cidr)), 0)::integer FROM subnets
WHERE organization_id = @organization_id AND vrf = @vrf AND cidr >>= @ip::inet;

-- name: ImportDeviceHasIP :one
SELECT count(*) FROM ip_addresses
WHERE organization_id = @organization_id AND device_id = @device_id AND host(address) = host(@ip::inet);
