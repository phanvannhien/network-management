ALTER TABLE devices DROP CONSTRAINT devices_template_fkey, DROP CONSTRAINT devices_mgmt_interface_fkey,
  DROP COLUMN template_id, DROP COLUMN poll_address, DROP COLUMN mgmt_interface_id;
DROP TABLE ip_addresses;
DROP TABLE interfaces;
DROP TABLE device_templates;
