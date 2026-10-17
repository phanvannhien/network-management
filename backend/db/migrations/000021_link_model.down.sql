UPDATE interfaces SET media = '' WHERE media IN ('PON', 'xDSL', 'Cellular');
ALTER TABLE interfaces DROP CONSTRAINT interfaces_media_check;
ALTER TABLE interfaces ADD CONSTRAINT interfaces_media_check
  CHECK (media IN ('', 'RJ45', 'SFP', 'SFP+', 'SFP28', 'QSFP', 'Serial', 'Radio', 'Console'));
UPDATE devices SET type = 'other' WHERE type IN ('provider_cloud', 'wireless_bridge', 'console_server', 'olt');
-- Lossy: new kinds fall back to the closest old one; fibre mode / connector / service are dropped.
UPDATE links SET medium = 'MPLS' WHERE kind = 'logical' AND service = 'mpls' AND medium = '';
UPDATE links SET kind = 'ethernet' WHERE kind IN ('power', 'stack', 'dsl');
UPDATE links SET kind = 'wireless' WHERE kind = 'cellular';
ALTER TABLE links DROP CONSTRAINT links_fiber_fields_check;
ALTER TABLE links DROP COLUMN fiber_mode, DROP COLUMN connector, DROP COLUMN service;
ALTER TABLE links DROP CONSTRAINT links_kind_check;
ALTER TABLE links ADD CONSTRAINT links_kind_check
  CHECK (kind IN ('ethernet', 'fiber', 'wireless', 'serial', 'logical', 'console'));
