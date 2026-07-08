CREATE TYPE "public"."salary_change_event_type" AS ENUM('Created', 'Superseded', 'Canceled');--> statement-breakpoint
CREATE TYPE "public"."salary_change_mode" AS ENUM('OnePeriodOverride', 'ForwardEffective');--> statement-breakpoint
CREATE TYPE "public"."salary_change_status" AS ENUM('Active', 'Superseded', 'Canceled');--> statement-breakpoint
ALTER TYPE "public"."payroll_run_status" ADD VALUE 'Stale' BEFORE 'Reviewed';--> statement-breakpoint
CREATE TABLE "employee_salary_change_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"change_id" integer NOT NULL,
	"event_type" "salary_change_event_type" NOT NULL,
	"actor_user_id" varchar(255) NOT NULL,
	"notes" text,
	"event_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_salary_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"mode" "salary_change_mode" NOT NULL,
	"status" "salary_change_status" DEFAULT 'Active' NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"created_by_user_id" varchar(255) NOT NULL,
	"before_daily_rate" numeric(10, 2),
	"before_monthly_rate" numeric(10, 2),
	"before_monthly_allowance" numeric(10, 2),
	"before_daily_allowance" numeric(10, 2),
	"before_cola" numeric(10, 2),
	"before_rate_divisor" numeric(10, 2),
	"before_billing_rate" numeric(10, 2),
	"after_daily_rate" numeric(10, 2),
	"after_monthly_rate" numeric(10, 2),
	"after_monthly_allowance" numeric(10, 2),
	"after_daily_allowance" numeric(10, 2),
	"after_cola" numeric(10, 2),
	"after_rate_divisor" numeric(10, 2),
	"after_billing_rate" numeric(10, 2),
	"superseded_at" timestamp,
	"superseded_by_change_id" integer,
	"canceled_at" timestamp,
	"canceled_by_user_id" varchar(255),
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_run_employees" ADD COLUMN "salary_adjustment_id" integer;--> statement-breakpoint
ALTER TABLE "payroll_run_employees" ADD COLUMN "salary_adjustment_mode" "salary_change_mode";--> statement-breakpoint
ALTER TABLE "employee_salary_change_events" ADD CONSTRAINT "employee_salary_change_events_change_id_employee_salary_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."employee_salary_changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salary_changes" ADD CONSTRAINT "employee_salary_changes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salary_changes" ADD CONSTRAINT "employee_salary_changes_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_salary_change_event_change_id" ON "employee_salary_change_events" USING btree ("change_id");--> statement-breakpoint
CREATE INDEX "idx_salary_change_event_type" ON "employee_salary_change_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_salary_change_employee_status_mode" ON "employee_salary_changes" USING btree ("employee_id","status","mode");--> statement-breakpoint
CREATE INDEX "idx_salary_change_period_status" ON "employee_salary_changes" USING btree ("payroll_period_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_salary_change_active_override" ON "employee_salary_changes" USING btree ("employee_id","payroll_period_id") WHERE "employee_salary_changes"."status" = 'Active' and "employee_salary_changes"."mode" = 'OnePeriodOverride';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_salary_change_active_forward" ON "employee_salary_changes" USING btree ("employee_id","payroll_period_id") WHERE "employee_salary_changes"."status" = 'Active' and "employee_salary_changes"."mode" = 'ForwardEffective';--> statement-breakpoint
ALTER TABLE "payroll_run_employees" ADD CONSTRAINT "payroll_run_employees_salary_adjustment_id_employee_salary_changes_id_fk" FOREIGN KEY ("salary_adjustment_id") REFERENCES "public"."employee_salary_changes"("id") ON DELETE set null ON UPDATE no action;