-- Refuses while cables end in a segment (they would break the restored checks).
ALTER TABLE links DROP CONSTRAINT links_segment_no_port_check;
ALTER TABLE links DROP CONSTRAINT links_a_kind_check;
ALTER TABLE links DROP CONSTRAINT links_b_kind_check;
ALTER TABLE links ADD CONSTRAINT links_a_kind_check CHECK (a_kind IN ('device', 'endpoint_group'));
ALTER TABLE links ADD CONSTRAINT links_b_kind_check CHECK (b_kind IN ('device', 'endpoint_group'));
DROP TABLE segments;
