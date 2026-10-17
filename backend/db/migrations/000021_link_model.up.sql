-- ADR-033: link kinds as engineers wire networks. DAC is copper (ethernet), a LAG is drawn as its member cables, MPLS
-- is a WAN service of the line, not a line style. New kinds: power, stack, dsl, cellular. Fibre records mode and
-- connector so mismatches can be caught.

ALTER TABLE links DROP CONSTRAINT links_kind_check;
ALTER TABLE links ADD CONSTRAINT links_kind_check
  CHECK (kind IN ('ethernet', 'fiber', 'wireless', 'serial', 'console', 'power', 'stack', 'dsl', 'cellular', 'logical'));

ALTER TABLE links
  ADD COLUMN fiber_mode text NOT NULL DEFAULT '' CHECK (fiber_mode IN ('', 'sm', 'mm')),
  ADD COLUMN connector  text NOT NULL DEFAULT '' CHECK (connector IN ('', 'LC', 'SC', 'MPO', 'ST')),
  ADD COLUMN service    text NOT NULL DEFAULT '' CHECK (service IN ('', 'internet_broadband', 'internet_dedicated',
                                                          'mpls', 'leased_line', 'metro', 'mobile', 'other')),
  ADD CONSTRAINT links_fiber_fields_check CHECK (kind = 'fiber' OR (fiber_mode = '' AND connector = ''));

-- DAC twinax is copper.
UPDATE links SET kind = 'ethernet', version = version + 1 WHERE kind = 'fiber' AND upper(medium) = 'DAC';
-- Fibre variants already typed as SM / MM.
UPDATE links SET fiber_mode = 'sm' WHERE kind = 'fiber' AND upper(medium) LIKE 'SM%';
UPDATE links SET fiber_mode = 'mm' WHERE kind = 'fiber' AND (upper(medium) LIKE 'MM%' OR upper(medium) LIKE '%OM_%');
-- MPLS becomes the service of the line.
UPDATE links SET service = 'mpls', medium = '', version = version + 1 WHERE kind = 'logical' AND upper(medium) = 'MPLS';

-- Port media for GPON (a PON port feeds many ONTs through a passive splitter), DSL / coax and cellular modems.
ALTER TABLE interfaces DROP CONSTRAINT interfaces_media_check;
ALTER TABLE interfaces ADD CONSTRAINT interfaces_media_check
  CHECK (media IN ('', 'RJ45', 'SFP', 'SFP+', 'SFP28', 'QSFP', 'PON', 'xDSL', 'Serial', 'Radio', 'Console', 'Cellular'));
