-- ADR-035 (rev. 2026-10-17): a device created from a system template (built-in catalog) remembers which one.
ALTER TABLE devices ADD COLUMN catalog_id text NOT NULL DEFAULT '' CHECK (length(catalog_id) <= 100);
