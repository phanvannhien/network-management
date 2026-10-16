DROP VIEW ipam_addresses;
CREATE VIEW ipam_addresses AS
SELECT ip.organization_id, ip.vrf, host(ip.address)::inet AS host, ip.address::text AS address, ip.role,
       d.id AS device_id, NULL::uuid AS cluster_id, d.hostname, COALESCE(i.name, '') AS interface_name,
       d.business_unit_id AS unit_id, d.site_id
FROM ip_addresses ip
JOIN devices d ON d.id = ip.device_id AND d.deleted_at IS NULL
LEFT JOIN interfaces i ON i.id = ip.interface_id
UNION ALL
SELECT c.organization_id, '' AS vrf, host(c.mgmt_ip)::inet, c.mgmt_ip::text, 'primary',
       NULL::uuid, c.id, COALESCE(NULLIF(c.hostname, ''), c.name), '', c.business_unit_id, c.site_id
FROM device_clusters c
WHERE c.mgmt_ip IS NOT NULL;
DROP TABLE endpoint_members;
DROP TABLE endpoint_groups;
ALTER TABLE ip_ranges DROP CONSTRAINT ip_ranges_id_org_key;
