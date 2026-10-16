-- Interface MAC (searched by Ctrl+K, SRS §2/§12) and the 802.1Q tag of a sub-interface (e.g. Gi0/0.10 → dot1q 10).
ALTER TABLE interfaces
  ADD COLUMN mac macaddr,
  ADD COLUMN vlan_tag integer CHECK (vlan_tag BETWEEN 1 AND 4094),
  ADD CONSTRAINT interfaces_vlan_tag_kind_check CHECK (vlan_tag IS NULL OR kind = 'subinterface');
CREATE INDEX interfaces_mac_idx ON interfaces (organization_id, mac) WHERE mac IS NOT NULL;
