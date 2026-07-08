CREATE TYPE "public"."attendance_dtr_correction_type" AS ENUM('Duplicate Punch', 'Missing Out', 'No Logs', 'Ambiguous Sequence');--> statement-breakpoint
CREATE TYPE "public"."attendance_dtr_correction_status" AS ENUM('Pending', 'Approved', 'Rejected');--> statement-breakpoint
CREATE TABLE "attendance_dtr_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"correction_type" "attendance_dtr_correction_type" NOT NULL,
	"status" "attendance_dtr_correction_status" DEFAULT 'Pending' NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"payload" jsonb NOT NULL,
	"reviewed_by_user_id" varchar(255),
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_dtr_corrections" ADD CONSTRAINT "attendance_dtr_corrections_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_dtr_corrections" ADD CONSTRAINT "attendance_dtr_corrections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_attendance_dtr_correction_day_type" ON "attendance_dtr_corrections" USING btree ("payroll_period_id","employee_id","attendance_date","correction_type");--> statement-breakpoint
CREATE INDEX "idx_attendance_dtr_correction_period_status" ON "attendance_dtr_corrections" USING btree ("payroll_period_id","status");--> statement-breakpoint
CREATE INDEX "idx_attendance_dtr_correction_employee_date" ON "attendance_dtr_corrections" USING btree ("employee_id","attendance_date");
