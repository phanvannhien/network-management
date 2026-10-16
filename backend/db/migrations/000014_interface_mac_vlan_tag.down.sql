DROP INDEX interfaces_mac_idx;
ALTER TABLE interfaces DROP CONSTRAINT interfaces_vlan_tag_kind_check, DROP COLUMN vlan_tag, DROP COLUMN mac;
