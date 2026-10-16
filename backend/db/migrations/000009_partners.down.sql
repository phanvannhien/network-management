-- Back to P1-07: sites point at their unit's partner again (units collapse into partners).
ALTER TABLE sites DROP CONSTRAINT sites_business_unit_fkey;
UPDATE sites s SET business_unit_id = u.partner_id FROM business_units u WHERE u.id = s.business_unit_id;
DROP TABLE business_units;
ALTER TRIGGER partners_updated_at ON partners RENAME TO business_units_updated_at;
ALTER INDEX partners_id_organization_id_key RENAME TO business_units_id_organization_id_key;
ALTER INDEX partners_pkey RENAME TO business_units_pkey;
ALTER INDEX partners_org_code_live_idx RENAME TO business_units_org_code_live_idx;
ALTER TABLE partners RENAME CONSTRAINT partners_code_not_shared TO business_units_code_not_shared;
ALTER TABLE partners RENAME TO business_units;
ALTER TABLE sites ADD CONSTRAINT sites_business_unit_fkey FOREIGN KEY (business_unit_id, organization_id)
  REFERENCES business_units (id, organization_id) ON DELETE RESTRICT;
