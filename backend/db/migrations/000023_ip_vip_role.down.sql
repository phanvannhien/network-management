UPDATE ip_addresses SET role = 'secondary' WHERE role = 'vip';
ALTER TABLE ip_addresses DROP CONSTRAINT ip_addresses_role_check;
ALTER TABLE ip_addresses ADD CONSTRAINT ip_addresses_role_check CHECK (role IN ('primary', 'secondary', 'nat', 'public'));
