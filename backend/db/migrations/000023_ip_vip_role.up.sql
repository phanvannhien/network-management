-- ADR-038: a VRRP / HSRP virtual IP (gateway redundancy) is configured on two or more devices on purpose: role "vip".
ALTER TABLE ip_addresses DROP CONSTRAINT ip_addresses_role_check;
ALTER TABLE ip_addresses ADD CONSTRAINT ip_addresses_role_check CHECK (role IN ('primary', 'secondary', 'nat', 'public', 'vip'));
