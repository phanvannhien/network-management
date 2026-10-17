-- .ntb.json import (P1-22, ADR-037): where the file's objects land. Every query takes organization_id.

-- name: NtbSiteMatch :one
-- A live site of the organization with this code (full or own part) or, failing that, this name.
SELECT id FROM sites
WHERE organization_id = @organization_id AND deleted_at IS NULL
  AND (lower(code) = lower(@code) OR lower(local_code) = lower(@code) OR lower(name) = lower(@name))
ORDER BY (lower(code) = lower(@code)) DESC, (lower(local_code) = lower(@code)) DESC
LIMIT 1;

-- name: NtbDeviceInSite :one
-- Members of a cluster share a hostname: their member number tells them apart.
SELECT id FROM devices
WHERE organization_id = @organization_id AND site_id = @site_id AND deleted_at IS NULL
  AND lower(hostname) = lower(@hostname)
  AND (sqlc.narg('member_no')::int IS NULL OR cluster_member_no = sqlc.narg('member_no')::int)
ORDER BY created_at
LIMIT 1;

-- name: NtbGroupInSite :one
SELECT id FROM endpoint_groups
WHERE organization_id = @organization_id AND site_id = @site_id AND lower(name) = lower(@name);

-- name: NtbRangeMatch :one
-- The same range (same VRF, first and last address) already planned in the organization.
SELECT r.id FROM ip_ranges r
JOIN subnets sn ON sn.id = r.subnet_id
WHERE r.organization_id = @organization_id AND sn.vrf = @vrf
  AND host(r.start_ip) = @start_ip::text AND host(r.end_ip) = @end_ip::text
LIMIT 1;

-- name: NtbLinkBetween :one
-- A cable already joining the same two ends (same ports), so a second import does not duplicate it.
SELECT id FROM links
WHERE organization_id = @organization_id
  AND ((a_id = @a_id AND b_id = @b_id AND a_interface_id IS NOT DISTINCT FROM sqlc.narg('a_iface')::uuid
        AND b_interface_id IS NOT DISTINCT FROM sqlc.narg('b_iface')::uuid)
    OR (a_id = @b_id AND b_id = @a_id AND a_interface_id IS NOT DISTINCT FROM sqlc.narg('b_iface')::uuid
        AND b_interface_id IS NOT DISTINCT FROM sqlc.narg('a_iface')::uuid))
LIMIT 1;
