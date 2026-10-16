-- Partner / unit grants and record shares (P1-07c, ADR-029, ADR-031). Every query takes organization_id.

-- name: ListAccessGrants :many
-- The caller's grants on live partners/units; business_unit_id is NULL for a partner grant.
SELECT pm.partner_id, NULL::uuid AS business_unit_id, pm.role
FROM partner_members pm
JOIN partners p ON p.id = pm.partner_id AND p.deleted_at IS NULL
WHERE pm.organization_id = @organization_id AND pm.user_id = @user_id
UNION ALL
SELECT b.partner_id, um.business_unit_id, um.role
FROM business_unit_members um
JOIN business_units b ON b.id = um.business_unit_id AND b.deleted_at IS NULL
JOIN partners p ON p.id = b.partner_id AND p.deleted_at IS NULL
WHERE um.organization_id = @organization_id AND um.user_id = @user_id;

-- name: ListPartnerMembers :many
SELECT pm.user_id, u.email, u.display_name, pm.role, pm.version, pm.created_at,
       (u.password_hash = '')::boolean AS pending_invite
FROM partner_members pm
JOIN users u ON u.id = pm.user_id
WHERE pm.organization_id = @organization_id AND pm.partner_id = @partner_id
ORDER BY lower(u.display_name), lower(u.email::text);

-- name: GetPartnerMember :one
SELECT pm.user_id, u.email, u.display_name, pm.role, pm.version, pm.created_at,
       (u.password_hash = '')::boolean AS pending_invite
FROM partner_members pm
JOIN users u ON u.id = pm.user_id
WHERE pm.organization_id = @organization_id AND pm.partner_id = @partner_id AND pm.user_id = @user_id;

-- name: AddPartnerMember :exec
INSERT INTO partner_members (organization_id, partner_id, user_id, role, granted_by)
VALUES (@organization_id, @partner_id, @user_id, @role, @granted_by);

-- name: UpdatePartnerMember :execrows
UPDATE partner_members SET role = @role, version = version + 1
WHERE organization_id = @organization_id AND partner_id = @partner_id AND user_id = @user_id AND version = @version;

-- name: DeletePartnerMember :execrows
DELETE FROM partner_members WHERE organization_id = @organization_id AND partner_id = @partner_id AND user_id = @user_id;

-- name: ListUnitMembers :many
SELECT um.user_id, u.email, u.display_name, um.role, um.version, um.created_at,
       (u.password_hash = '')::boolean AS pending_invite
FROM business_unit_members um
JOIN users u ON u.id = um.user_id
WHERE um.organization_id = @organization_id AND um.business_unit_id = @business_unit_id
ORDER BY lower(u.display_name), lower(u.email::text);

-- name: GetUnitMember :one
SELECT um.user_id, u.email, u.display_name, um.role, um.version, um.created_at,
       (u.password_hash = '')::boolean AS pending_invite
FROM business_unit_members um
JOIN users u ON u.id = um.user_id
WHERE um.organization_id = @organization_id AND um.business_unit_id = @business_unit_id AND um.user_id = @user_id;

-- name: AddUnitMember :exec
INSERT INTO business_unit_members (organization_id, business_unit_id, user_id, role, granted_by)
VALUES (@organization_id, @business_unit_id, @user_id, @role, @granted_by);

-- name: UpdateUnitMember :execrows
UPDATE business_unit_members SET role = @role, version = version + 1
WHERE organization_id = @organization_id AND business_unit_id = @business_unit_id AND user_id = @user_id
  AND version = @version;

-- name: DeleteUnitMember :execrows
DELETE FROM business_unit_members
WHERE organization_id = @organization_id AND business_unit_id = @business_unit_id AND user_id = @user_id;

-- name: EnsureMembership :one
-- Grant-only users join the organization with role 'member'; existing memberships are kept as they are.
-- Returns true when the membership was created by this call.
WITH ins AS (
  INSERT INTO memberships (organization_id, user_id, role) VALUES (@organization_id, @user_id, 'member')
  ON CONFLICT (organization_id, user_id) DO NOTHING
  RETURNING 1
)
SELECT EXISTS (SELECT 1 FROM ins)::boolean AS created;

-- name: ListSiteShares :many
SELECT r.id, r.target_type, r.target_partner_id, r.target_unit_id, r.access, r.granted_at, r.version,
       COALESCE(tp.id, tup.id) AS target_unit_partner_id,
       COALESCE(tp.code, tup.code || ' › ' || tu.code, '')::text AS target_code,
       COALESCE(tp.name, tu.name, '')::text AS target_name
FROM resource_shares r
LEFT JOIN partners tp ON tp.id = r.target_partner_id
LEFT JOIN business_units tu ON tu.id = r.target_unit_id
LEFT JOIN partners tup ON tup.id = tu.partner_id
WHERE r.organization_id = @organization_id AND r.resource_type = 'site' AND r.resource_id = @site_id
  AND (tp.deleted_at IS NULL AND tu.deleted_at IS NULL AND tup.deleted_at IS NULL)
ORDER BY target_code;

-- name: CreateSiteShare :one
INSERT INTO resource_shares (organization_id, resource_type, resource_id, target_type, target_partner_id,
                             target_unit_id, access, granted_by)
VALUES (@organization_id, 'site', @site_id, @target_type, sqlc.narg('target_partner_id'), sqlc.narg('target_unit_id'),
        @access, @granted_by)
RETURNING id;

-- name: UpdateSiteShare :execrows
UPDATE resource_shares SET access = @access, version = version + 1
WHERE id = @id AND organization_id = @organization_id AND resource_type = 'site' AND resource_id = @site_id
  AND version = @version;

-- name: DeleteSiteShare :execrows
DELETE FROM resource_shares
WHERE id = @id AND organization_id = @organization_id AND resource_type = 'site' AND resource_id = @site_id;

-- name: ListSharesForSites :many
-- Shares of the given sites with the target's partner, to compute the caller's access on a site list.
SELECT r.resource_id AS site_id, r.target_partner_id, r.target_unit_id, tu.partner_id AS target_unit_partner_id, r.access
FROM resource_shares r
LEFT JOIN partners tp ON tp.id = r.target_partner_id
LEFT JOIN business_units tu ON tu.id = r.target_unit_id
WHERE r.organization_id = @organization_id AND r.resource_type = 'site' AND r.resource_id = ANY (@site_ids::uuid[])
  AND tp.deleted_at IS NULL AND tu.deleted_at IS NULL;
