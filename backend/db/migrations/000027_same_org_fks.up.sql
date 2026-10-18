-- P2-01: the database itself refuses a reference to another organization's row (second line of defence behind the
-- handlers' checks), like migrations 000007–000020 already do with composite (id, organization_id) foreign keys.

ALTER TABLE interfaces     ADD CONSTRAINT interfaces_id_org_key     UNIQUE (id, organization_id);
ALTER TABLE links          ADD CONSTRAINT links_id_org_key          UNIQUE (id, organization_id);
ALTER TABLE vendors        ADD CONSTRAINT vendors_id_org_key        UNIQUE (id, organization_id);
ALTER TABLE contracts      ADD CONSTRAINT contracts_id_org_key      UNIQUE (id, organization_id);
ALTER TABLE credentials    ADD CONSTRAINT credentials_id_org_key    UNIQUE (id, organization_id);
ALTER TABLE cloud_accounts ADD CONSTRAINT cloud_accounts_id_org_key UNIQUE (id, organization_id);

ALTER TABLE links ADD CONSTRAINT links_a_iface_same_org FOREIGN KEY (a_interface_id, organization_id)
  REFERENCES interfaces (id, organization_id) ON DELETE SET NULL (a_interface_id);
ALTER TABLE links ADD CONSTRAINT links_b_iface_same_org FOREIGN KEY (b_interface_id, organization_id)
  REFERENCES interfaces (id, organization_id) ON DELETE SET NULL (b_interface_id);
ALTER TABLE endpoint_members ADD CONSTRAINT endpoint_members_iface_same_org FOREIGN KEY (interface_id, organization_id)
  REFERENCES interfaces (id, organization_id) ON DELETE SET NULL (interface_id);

ALTER TABLE vendor_contacts ADD CONSTRAINT vendor_contacts_vendor_same_org FOREIGN KEY (vendor_id, organization_id)
  REFERENCES vendors (id, organization_id) ON DELETE CASCADE;
ALTER TABLE contracts ADD CONSTRAINT contracts_vendor_same_org FOREIGN KEY (vendor_id, organization_id)
  REFERENCES vendors (id, organization_id);
ALTER TABLE contract_items ADD CONSTRAINT contract_items_contract_same_org FOREIGN KEY (contract_id, organization_id)
  REFERENCES contracts (id, organization_id) ON DELETE CASCADE;
ALTER TABLE contract_items ADD CONSTRAINT contract_items_device_same_org FOREIGN KEY (device_id, organization_id)
  REFERENCES devices (id, organization_id) ON DELETE CASCADE;
ALTER TABLE contract_items ADD CONSTRAINT contract_items_link_same_org FOREIGN KEY (link_id, organization_id)
  REFERENCES links (id, organization_id) ON DELETE CASCADE;
ALTER TABLE files ADD CONSTRAINT files_contract_same_org FOREIGN KEY (contract_id, organization_id)
  REFERENCES contracts (id, organization_id) ON DELETE CASCADE;
ALTER TABLE devices ADD CONSTRAINT devices_supplier_same_org FOREIGN KEY (supplier_id, organization_id)
  REFERENCES vendors (id, organization_id) ON DELETE SET NULL (supplier_id);

ALTER TABLE credential_devices ADD CONSTRAINT credential_devices_credential_same_org FOREIGN KEY (credential_id, organization_id)
  REFERENCES credentials (id, organization_id) ON DELETE CASCADE;
ALTER TABLE credential_devices ADD CONSTRAINT credential_devices_device_same_org FOREIGN KEY (device_id, organization_id)
  REFERENCES devices (id, organization_id) ON DELETE CASCADE;
ALTER TABLE cloud_account_devices ADD CONSTRAINT cloud_account_devices_account_same_org FOREIGN KEY (cloud_account_id, organization_id)
  REFERENCES cloud_accounts (id, organization_id) ON DELETE CASCADE;
ALTER TABLE cloud_account_devices ADD CONSTRAINT cloud_account_devices_device_same_org FOREIGN KEY (device_id, organization_id)
  REFERENCES devices (id, organization_id) ON DELETE CASCADE;
ALTER TABLE cloud_accounts ADD CONSTRAINT cloud_accounts_vendor_same_org FOREIGN KEY (vendor_id, organization_id)
  REFERENCES vendors (id, organization_id) ON DELETE SET NULL (vendor_id);

ALTER TABLE notifications ADD CONSTRAINT notifications_device_same_org FOREIGN KEY (device_id, organization_id)
  REFERENCES devices (id, organization_id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT notifications_contract_same_org FOREIGN KEY (contract_id, organization_id)
  REFERENCES contracts (id, organization_id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT notifications_credential_same_org FOREIGN KEY (credential_id, organization_id)
  REFERENCES credentials (id, organization_id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT notifications_cloud_same_org FOREIGN KEY (cloud_account_id, organization_id)
  REFERENCES cloud_accounts (id, organization_id) ON DELETE CASCADE;
