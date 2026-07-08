CREATE TYPE "public"."payroll_exception_dtr_override_source" AS ENUM('DTR_WORKED', 'DTR_TARDINESS', 'DTR_REGULAR_OVERTIME');--> statement-breakpoint
ALTER TABLE "employee_payroll_exception_rows" ADD COLUMN "dtr_override_source" "payroll_exception_dtr_override_source";--> statement-breakpoint
CREATE INDEX "idx_employee_payroll_exception_dtr_override_source" ON "employee_payroll_exception_rows" USING btree ("dtr_override_source");
