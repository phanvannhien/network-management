DROP TABLE resource_shares;
DROP TABLE business_unit_members;
DROP TABLE partner_members;
ALTER TABLE memberships ADD COLUMN site_scope uuid[];
-- Members without an organization role lose access entirely (their grants are gone).
DELETE FROM memberships WHERE role = 'member';
ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'admin', 'editor', 'viewer'));
