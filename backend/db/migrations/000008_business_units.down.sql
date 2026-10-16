ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_business_unit_fkey;
DROP INDEX IF EXISTS sites_business_unit_idx;
ALTER TABLE sites DROP COLUMN IF EXISTS isp, DROP COLUMN IF EXISTS business_unit_id, DROP COLUMN IF EXISTS kind;
DROP TABLE IF EXISTS business_units;
