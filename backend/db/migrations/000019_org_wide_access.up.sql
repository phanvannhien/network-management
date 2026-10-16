-- P1-28 (ADR-032): access is decided by the organization role only. Partner / unit grants and record shares go;
-- grant-only members become viewers of the whole organization.
DROP TABLE resource_shares;
DROP TABLE business_unit_members;
DROP TABLE partner_members;
UPDATE memberships SET role = 'viewer' WHERE role = 'member';
ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'admin', 'editor', 'viewer'));
