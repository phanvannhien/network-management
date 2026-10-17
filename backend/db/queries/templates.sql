
-- name: FindTemplateForCatalog :one
-- The organization's template already standing for a catalog model: same name, or same type and model / part number.
SELECT * FROM device_templates
WHERE organization_id = @organization_id
  AND (lower(name) = lower(@name)
    OR (type = @type AND (lower(model) = lower(@model)
      OR (part_number <> '' AND lower(part_number) = ANY (@part_numbers::text[])))))
ORDER BY (lower(name) = lower(@name)) DESC, created_at
LIMIT 1;
