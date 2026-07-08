ALTER TYPE "public"."payroll_exception_dtr_override_source" ADD VALUE IF NOT EXISTS 'DTR_HOLD_WORKED';--> statement-breakpoint
ALTER TYPE "public"."payroll_exception_dtr_override_source" ADD VALUE IF NOT EXISTS 'DTR_HOLD_TARDINESS';--> statement-breakpoint
ALTER TYPE "public"."payroll_exception_dtr_override_source" ADD VALUE IF NOT EXISTS 'DTR_HOLD_UNDERTIME';--> statement-breakpoint
ALTER TYPE "public"."payroll_exception_dtr_override_source" ADD VALUE IF NOT EXISTS 'DTR_HOLD_REGULAR_OVERTIME';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_employee_payroll_exception_period_employee_dtr_source" ON "employee_payroll_exception_rows" USING btree ("payroll_period_id","employee_id","dtr_override_source");--> statement-breakpoint
WITH regular_ot AS (
  SELECT COALESCE(
    (
      SELECT "rate_multiplier"::text
      FROM "overtime_rules"
      WHERE "category" = 'REGULAR_DAY'
      ORDER BY "minutes_from", "id"
      LIMIT 1
    ),
    '1.2500'
  ) AS multiplier
),
desired_codes AS (
  SELECT
    'HOLD-REG'::varchar AS account_code,
    'Regular Hours'::account_type_enum AS account_type,
    'Held DTR Worked/Regular Hours'::varchar AS description,
    '1.0000'::numeric AS daily_rate,
    '1.0000'::numeric AS monthly_rate
  UNION ALL
  SELECT
    'HOLD-OT'::varchar,
    'Overtime'::account_type_enum,
    'Held DTR Regular Overtime'::varchar,
    (SELECT multiplier::numeric FROM regular_ot),
    (SELECT multiplier::numeric FROM regular_ot)
  UNION ALL
  SELECT
    'HOLD-UT'::varchar,
    'Unpaid Leaves/Absences'::account_type_enum,
    'Held DTR Undertime/Absence'::varchar,
    NULL::numeric,
    NULL::numeric
  UNION ALL
  SELECT
    'HOLD-LATE'::varchar,
    'Other Deduction'::account_type_enum,
    'Held DTR Late/Tardiness'::varchar,
    NULL::numeric,
    NULL::numeric
)
INSERT INTO "accountCode" (
  "account_Code",
  "account_Type",
  "description",
  "daily_rate",
  "monthly_rate",
  "month_13th_pay",
  "non_taxable",
  "deminimis",
  "health_insurance"
)
SELECT
  desired_codes.account_code,
  desired_codes.account_type,
  desired_codes.description,
  desired_codes.daily_rate,
  desired_codes.monthly_rate,
  false,
  false,
  false,
  false
FROM desired_codes
WHERE NOT EXISTS (
  SELECT 1
  FROM "accountCode"
  WHERE "account_Code" = desired_codes.account_code
);
