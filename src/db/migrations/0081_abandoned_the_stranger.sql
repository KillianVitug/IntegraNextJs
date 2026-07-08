CREATE TYPE "public"."attendance_dtr_day_type" AS ENUM('Regular Day', 'Legal/Regular Holiday', 'Special Non-Working Holiday', 'Special Working Holiday', 'Company Holiday');--> statement-breakpoint
CREATE TABLE "employee_attendance_day_type_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"day_type" "attendance_dtr_day_type" NOT NULL,
	"remarks" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_attendance_day_type_overrides" ADD CONSTRAINT "employee_attendance_day_type_overrides_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_attendance_day_type_overrides" ADD CONSTRAINT "employee_attendance_day_type_overrides_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employee_attendance_day_type_override" ON "employee_attendance_day_type_overrides" USING btree ("payroll_period_id","employee_id","attendance_date");--> statement-breakpoint
CREATE INDEX "idx_employee_attendance_day_type_override_employee_date" ON "employee_attendance_day_type_overrides" USING btree ("employee_id","attendance_date");