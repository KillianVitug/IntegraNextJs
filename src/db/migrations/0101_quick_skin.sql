CREATE TABLE "attendance_dtr_hold_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_payroll_period_id" uuid NOT NULL,
	"target_payroll_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'Approved' NOT NULL,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"undertime_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"approved_by_user_id" varchar(255),
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_dtr_hold_approvals" ADD CONSTRAINT "attendance_dtr_hold_approvals_source_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("source_payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_dtr_hold_approvals" ADD CONSTRAINT "attendance_dtr_hold_approvals_target_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("target_payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_dtr_hold_approvals" ADD CONSTRAINT "attendance_dtr_hold_approvals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_attendance_dtr_hold_approval_day" ON "attendance_dtr_hold_approvals" USING btree ("source_payroll_period_id","employee_id","attendance_date");--> statement-breakpoint
CREATE INDEX "idx_attendance_dtr_hold_approval_source" ON "attendance_dtr_hold_approvals" USING btree ("source_payroll_period_id");--> statement-breakpoint
CREATE INDEX "idx_attendance_dtr_hold_approval_target" ON "attendance_dtr_hold_approvals" USING btree ("target_payroll_period_id");--> statement-breakpoint
CREATE INDEX "idx_attendance_dtr_hold_approval_employee_date" ON "attendance_dtr_hold_approvals" USING btree ("employee_id","attendance_date");