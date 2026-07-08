UPDATE "pagibig_contribution_rates" AS pcr
SET "max_compensation_base" = '10000.00'
FROM "statutory_rule_versions" AS srv
WHERE pcr."version_id" = srv."id"
  AND srv."rule_type" = 'PAGIBIG'
  AND pcr."max_compensation_base" = '5000.00';
