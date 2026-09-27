UPDATE "employee_salary_changes"
SET
  "before_daily_rate" = CASE
    WHEN "before_monthly_rate" IS DISTINCT FROM "after_monthly_rate" THEN NULL
    ELSE "before_daily_rate"
  END,
  "after_daily_rate" = CASE
    WHEN "before_monthly_rate" IS DISTINCT FROM "after_monthly_rate" THEN NULL
    ELSE "after_daily_rate"
  END,
  "before_monthly_rate" = CASE
    WHEN "before_monthly_rate" IS DISTINCT FROM "after_monthly_rate" THEN "before_monthly_rate"
    ELSE NULL
  END,
  "after_monthly_rate" = CASE
    WHEN "before_monthly_rate" IS DISTINCT FROM "after_monthly_rate" THEN "after_monthly_rate"
    ELSE NULL
  END,
  "before_monthly_allowance" = NULL,
  "after_monthly_allowance" = NULL,
  "before_daily_allowance" = NULL,
  "after_daily_allowance" = NULL,
  "before_cola" = NULL,
  "after_cola" = NULL,
  "before_rate_divisor" = NULL,
  "after_rate_divisor" = NULL,
  "before_billing_rate" = NULL,
  "after_billing_rate" = NULL,
  "updated_at" = NOW()
WHERE "status" = 'Active';
