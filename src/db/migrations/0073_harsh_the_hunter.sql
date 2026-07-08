ALTER TYPE "public"."salary_change_mode" ADD VALUE 'MultiPeriodOverride';--> statement-breakpoint
ALTER TABLE "employee_salary_changes" ADD COLUMN "end_payroll_period_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_salary_changes" ADD CONSTRAINT "employee_salary_changes_end_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("end_payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_salary_change_end_period" ON "employee_salary_changes" USING btree ("end_payroll_period_id");