CREATE TYPE "public"."attendance_dtr_manual_status" AS ENUM('Present', 'Absent', 'Rest Day', 'Rest Day Work', 'No Logs');--> statement-breakpoint
CREATE TABLE "employee_attendance_day_status_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"status" "attendance_dtr_manual_status" NOT NULL,
	"remarks" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_attendance_period_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"present_days" numeric(6, 2),
	"worked_minutes" integer,
	"late_minutes" integer,
	"undertime_minutes" integer,
	"overtime_minutes" integer,
	"remarks" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_attendance_day_status_overrides" ADD CONSTRAINT "employee_attendance_day_status_overrides_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_attendance_day_status_overrides" ADD CONSTRAINT "employee_attendance_day_status_overrides_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_attendance_period_overrides" ADD CONSTRAINT "employee_attendance_period_overrides_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_attendance_period_overrides" ADD CONSTRAINT "employee_attendance_period_overrides_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employee_attendance_day_status_override" ON "employee_attendance_day_status_overrides" USING btree ("payroll_period_id","employee_id","attendance_date");--> statement-breakpoint
CREATE INDEX "idx_employee_attendance_day_status_override_employee_date" ON "employee_attendance_day_status_overrides" USING btree ("employee_id","attendance_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employee_attendance_period_override" ON "employee_attendance_period_overrides" USING btree ("payroll_period_id","employee_id");--> statement-breakpoint
CREATE INDEX "idx_employee_attendance_period_override_employee" ON "employee_attendance_period_overrides" USING btree ("employee_id");