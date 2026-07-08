DROP INDEX IF EXISTS "uq_employee_payroll_exception_row";--> statement-breakpoint
ALTER TABLE "employee_payroll_exception_rows" ALTER COLUMN "exception_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_payroll_exception_rows" ALTER COLUMN "worked_status" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_payroll_exception_rows" ALTER COLUMN "day_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_payroll_exception_rows" ADD COLUMN IF NOT EXISTS "account_code_id" integer;--> statement-breakpoint
ALTER TABLE "employee_payroll_exception_rows" ADD COLUMN IF NOT EXISTS "account_type_snapshot" "account_type_enum";--> statement-breakpoint
ALTER TABLE "employee_payroll_exception_rows" ADD COLUMN IF NOT EXISTS "account_description_snapshot" varchar(80);--> statement-breakpoint
ALTER TABLE "employee_payroll_exception_rows" ADD COLUMN IF NOT EXISTS "account_month_13th_pay_snapshot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_payroll_exception_rows" ADD COLUMN IF NOT EXISTS "account_non_taxable_snapshot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "employee_payroll_exception_rows"
SET
  "account_type_snapshot" = CASE
    WHEN "exception_type" = 'OVERTIME' THEN 'Overtime'::"account_type_enum"
    WHEN "exception_type" = 'WORKED_DAY_PREMIUM' THEN 'Sunday/Holiday'::"account_type_enum"
    WHEN "exception_type" = 'NON_WORKED_HOLIDAY' THEN 'Regular Hours'::"account_type_enum"
    ELSE "account_type_snapshot"
  END,
  "account_description_snapshot" = COALESCE(
    "account_description_snapshot",
    CASE
      WHEN "exception_type" = 'OVERTIME' THEN 'Overtime'
      WHEN "exception_type" = 'WORKED_DAY_PREMIUM' THEN 'Sunday/Holiday'
      WHEN "exception_type" = 'NON_WORKED_HOLIDAY' THEN 'Regular Hours'
      ELSE NULL
    END
  )
WHERE "account_type_snapshot" IS NULL;--> statement-breakpoint
UPDATE "employee_payroll_exception_rows" e
SET
  "account_code_id" = COALESCE(e."account_code_id", ac."id"),
  "account_type_snapshot" = COALESCE(ac."account_Type"::"account_type_enum", e."account_type_snapshot"),
  "account_description_snapshot" = COALESCE(ac."description", e."account_description_snapshot"),
  "account_month_13th_pay_snapshot" = ac."month_13th_pay",
  "account_non_taxable_snapshot" = ac."non_taxable"
FROM "accountCode" ac
WHERE ac."account_Code" = e."payroll_code_snapshot";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_payroll_exception_rows" ADD CONSTRAINT "employee_payroll_exception_rows_account_code_id_accountCode_id_fk" FOREIGN KEY ("account_code_id") REFERENCES "public"."accountCode"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_employee_payroll_exception_account_code" ON "employee_payroll_exception_rows" USING btree ("account_code_id");
