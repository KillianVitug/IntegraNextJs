CREATE TYPE "public"."attendance_import_format" AS ENUM('CSV', 'TXT');--> statement-breakpoint
CREATE TYPE "public"."attendance_import_status" AS ENUM('Pending', 'Processed', 'Failed');--> statement-breakpoint
CREATE TYPE "public"."attendance_log_direction" AS ENUM('IN', 'OUT', 'UNSPECIFIED');--> statement-breakpoint
CREATE TYPE "public"."holiday_type_enum" AS ENUM('Regular', 'Special Non-Working', 'Special Working', 'Company');--> statement-breakpoint
CREATE TYPE "public"."leave_ledger_transaction" AS ENUM('Grant', 'Accrual', 'Adjustment', 'Used', 'Reversal', 'Carryover', 'Expiry');--> statement-breakpoint
CREATE TYPE "public"."loan_installment_status" AS ENUM('Pending', 'Due', 'Paid', 'Skipped', 'Void');--> statement-breakpoint
CREATE TYPE "public"."loan_payment_source" AS ENUM('Payroll', 'Manual');--> statement-breakpoint
CREATE TYPE "public"."payroll_line_type" AS ENUM('Earning', 'Deduction', 'Employer Contribution', 'Information');--> statement-breakpoint
CREATE TYPE "public"."payroll_period_cycle" AS ENUM('A', 'B');--> statement-breakpoint
CREATE TYPE "public"."payroll_period_status" AS ENUM('Open', 'Closed', 'Processed');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_status" AS ENUM('Draft', 'Reviewed', 'Approved', 'Posted', 'Void');--> statement-breakpoint
CREATE TYPE "public"."statutory_rule_type" AS ENUM('SSS', 'PHILHEALTH', 'PAGIBIG', 'TAX');--> statement-breakpoint
CREATE TABLE "attendance_daily_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_assignment_id" integer,
	"source_batch_id" uuid,
	"attendance_date" date NOT NULL,
	"first_in_at" timestamp,
	"last_out_at" timestamp,
	"scheduled_in_time" time,
	"scheduled_out_time" time,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"regular_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"undertime_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"night_minutes" integer DEFAULT 0 NOT NULL,
	"paid_leave_minutes" integer DEFAULT 0 NOT NULL,
	"unpaid_leave_minutes" integer DEFAULT 0 NOT NULL,
	"absent_minutes" integer DEFAULT 0 NOT NULL,
	"is_rest_day" boolean DEFAULT false NOT NULL,
	"anomaly_flags" text,
	"remarks" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" uuid,
	"source_file_name" varchar(255) NOT NULL,
	"source_format" "attendance_import_format" NOT NULL,
	"source_hash" varchar(128),
	"status" "attendance_import_status" DEFAULT 'Pending' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"matched_rows" integer DEFAULT 0 NOT NULL,
	"unmatched_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_raw_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"employee_id" uuid,
	"employee_no" varchar(50) NOT NULL,
	"device_id" varchar(80),
	"site_code" varchar(80),
	"source_line" integer,
	"direction" "attendance_log_direction" DEFAULT 'UNSPECIFIED' NOT NULL,
	"logged_at" timestamp NOT NULL,
	"log_date" date NOT NULL,
	"log_time" time NOT NULL,
	"raw_text" text,
	"normalized_hash" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bir_withholding_tax_brackets" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"payroll_terms" "payroll_terms" NOT NULL,
	"compensation_from" numeric(10, 2) NOT NULL,
	"compensation_to" numeric(10, 2),
	"base_tax" numeric(10, 2) NOT NULL,
	"over_percentage" numeric(7, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_shift_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_name" varchar(80) NOT NULL,
	"shift_code" varchar(40),
	"shift_schedule" "shift_schedule",
	"effective_from" date NOT NULL,
	"effective_to" date,
	"check_in_time" time NOT NULL,
	"check_out_time" time NOT NULL,
	"break_minutes" integer DEFAULT 60 NOT NULL,
	"paid_break_minutes" integer DEFAULT 0 NOT NULL,
	"grace_minutes" integer DEFAULT 0 NOT NULL,
	"rest_day" "rest_day",
	"hours_per_day" numeric(5, 2) DEFAULT '8.00' NOT NULL,
	"is_flexible" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holiday_calendar" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"holiday_date" date NOT NULL,
	"holiday_type" "holiday_type_enum" NOT NULL,
	"location_code" varchar(50),
	"is_paid" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_balance_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" integer NOT NULL,
	"entry_date" date NOT NULL,
	"transaction_type" "leave_ledger_transaction" NOT NULL,
	"quantity" numeric(5, 2) NOT NULL,
	"balance_after" numeric(5, 2),
	"source_table" varchar(50),
	"source_id" varchar(50),
	"remarks" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"requires_balance" boolean DEFAULT true NOT NULL,
	"annual_entitlement" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"color_hex" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "leave_types_code_unique" UNIQUE("code"),
	CONSTRAINT "leave_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "loan_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"payroll_period_id" uuid,
	"payroll_code" varchar(20) NOT NULL,
	"installment_no" integer NOT NULL,
	"due_date" date NOT NULL,
	"scheduled_amount" numeric(10, 2) NOT NULL,
	"principal_amount" numeric(10, 2),
	"interest_amount" numeric(10, 2),
	"balance_after" numeric(10, 2),
	"status" "loan_installment_status" DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"installment_id" uuid,
	"payroll_run_employee_id" uuid,
	"payment_date" date NOT NULL,
	"amount_paid" numeric(10, 2) NOT NULL,
	"source" "loan_payment_source" DEFAULT 'Payroll' NOT NULL,
	"remarks" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pagibig_contribution_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"range_from" numeric(10, 2) NOT NULL,
	"range_to" numeric(10, 2) NOT NULL,
	"employee_rate" numeric(7, 6) NOT NULL,
	"employer_rate" numeric(7, 6) NOT NULL,
	"max_compensation_base" numeric(10, 2)
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(20) NOT NULL,
	"payroll_terms" "payroll_terms" NOT NULL,
	"cycle" "payroll_period_cycle" NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"nominal_pay_date" date NOT NULL,
	"adjusted_pay_date" date NOT NULL,
	"status" "payroll_period_status" DEFAULT 'Open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_periods_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payroll_run_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_no_snapshot" varchar(50) NOT NULL,
	"employee_name_snapshot" varchar(120) NOT NULL,
	"regular_pay" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"gross_pay" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"taxable_pay" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"non_taxable_pay" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"total_deductions" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"employee_contributions" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"employer_contributions" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"net_pay" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"breakdown_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_employee_id" uuid NOT NULL,
	"line_type" "payroll_line_type" NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" varchar(150) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"quantity" numeric(10, 2),
	"rate" numeric(12, 4),
	"taxable" boolean DEFAULT false NOT NULL,
	"month_13th_eligible" boolean DEFAULT false NOT NULL,
	"source_table" varchar(50),
	"source_id" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"status" "payroll_run_status" DEFAULT 'Draft' NOT NULL,
	"run_number" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"computed_at" timestamp,
	"reviewed_at" timestamp,
	"approved_at" timestamp,
	"posted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "philhealth_contribution_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"monthly_basic_salary_floor" numeric(10, 2) NOT NULL,
	"monthly_basic_salary_ceiling" numeric(10, 2) NOT NULL,
	"premium_rate" numeric(7, 6) NOT NULL,
	"employee_share_rate" numeric(7, 6) NOT NULL,
	"employer_share_rate" numeric(7, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sss_contribution_brackets" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"range_from" numeric(10, 2) NOT NULL,
	"range_to" numeric(10, 2) NOT NULL,
	"salary_credit" numeric(10, 2) NOT NULL,
	"employee_share" numeric(10, 2) NOT NULL,
	"employer_share" numeric(10, 2) NOT NULL,
	"ec_share" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statutory_rule_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_type" "statutory_rule_type" NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" text,
	"payroll_terms" "payroll_terms" NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "statutory_rule_versions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "employees_leave_records" ADD COLUMN "leave_type_id" integer;--> statement-breakpoint
ALTER TABLE "attendance_daily_summaries" ADD CONSTRAINT "attendance_daily_summaries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_daily_summaries" ADD CONSTRAINT "attendance_daily_summaries_shift_assignment_id_employee_shift_assignments_id_fk" FOREIGN KEY ("shift_assignment_id") REFERENCES "public"."employee_shift_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_daily_summaries" ADD CONSTRAINT "attendance_daily_summaries_source_batch_id_attendance_import_batches_id_fk" FOREIGN KEY ("source_batch_id") REFERENCES "public"."attendance_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_import_batches" ADD CONSTRAINT "attendance_import_batches_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_raw_logs" ADD CONSTRAINT "attendance_raw_logs_batch_id_attendance_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."attendance_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_raw_logs" ADD CONSTRAINT "attendance_raw_logs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bir_withholding_tax_brackets" ADD CONSTRAINT "bir_withholding_tax_brackets_version_id_statutory_rule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."statutory_rule_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ADD CONSTRAINT "employee_shift_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_ledger" ADD CONSTRAINT "leave_balance_ledger_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_ledger" ADD CONSTRAINT "leave_balance_ledger_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_loan_id_employees_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."employees_loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_loan_id_employees_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."employees_loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_installment_id_loan_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."loan_installments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_payroll_run_employee_id_payroll_run_employees_id_fk" FOREIGN KEY ("payroll_run_employee_id") REFERENCES "public"."payroll_run_employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagibig_contribution_rates" ADD CONSTRAINT "pagibig_contribution_rates_version_id_statutory_rule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."statutory_rule_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_employees" ADD CONSTRAINT "payroll_run_employees_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_employees" ADD CONSTRAINT "payroll_run_employees_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_payroll_run_employee_id_payroll_run_employees_id_fk" FOREIGN KEY ("payroll_run_employee_id") REFERENCES "public"."payroll_run_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "philhealth_contribution_rates" ADD CONSTRAINT "philhealth_contribution_rates_version_id_statutory_rule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."statutory_rule_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sss_contribution_brackets" ADD CONSTRAINT "sss_contribution_brackets_version_id_statutory_rule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."statutory_rule_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_attendance_daily_employee_date" ON "attendance_daily_summaries" USING btree ("employee_id","attendance_date");--> statement-breakpoint
CREATE INDEX "idx_attendance_batch_payroll_period_id" ON "attendance_import_batches" USING btree ("payroll_period_id");--> statement-breakpoint
CREATE INDEX "idx_attendance_raw_logs_batch_id" ON "attendance_raw_logs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_attendance_raw_logs_employee_id" ON "attendance_raw_logs" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_attendance_raw_logs_log_date" ON "attendance_raw_logs" USING btree ("log_date");--> statement-breakpoint
CREATE INDEX "idx_bir_tax_bracket_version_id" ON "bir_withholding_tax_brackets" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "idx_shift_assignment_employee_id" ON "employee_shift_assignments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_shift_assignment_effective_from" ON "employee_shift_assignments" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "idx_holiday_calendar_date" ON "holiday_calendar" USING btree ("holiday_date");--> statement-breakpoint
CREATE INDEX "idx_leave_ledger_employee_leave_type" ON "leave_balance_ledger" USING btree ("employee_id","leave_type_id");--> statement-breakpoint
CREATE INDEX "idx_loan_installment_loan_id" ON "loan_installments" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "idx_loan_installment_payroll_code" ON "loan_installments" USING btree ("payroll_code");--> statement-breakpoint
CREATE INDEX "idx_loan_payment_loan_id" ON "loan_payments" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "idx_pagibig_contribution_version_id" ON "pagibig_contribution_rates" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_period_year_month" ON "payroll_periods" USING btree ("year","month");--> statement-breakpoint
CREATE INDEX "idx_payroll_period_adjusted_pay_date" ON "payroll_periods" USING btree ("adjusted_pay_date");--> statement-breakpoint
CREATE INDEX "idx_payroll_run_employee_run_id" ON "payroll_run_employees" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_run_employee_employee_id" ON "payroll_run_employees" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_run_line_employee_id" ON "payroll_run_lines" USING btree ("payroll_run_employee_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_run_period_id" ON "payroll_runs" USING btree ("payroll_period_id");--> statement-breakpoint
CREATE INDEX "idx_philhealth_contribution_version_id" ON "philhealth_contribution_rates" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "idx_sss_contribution_version_id" ON "sss_contribution_brackets" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "idx_statutory_rule_type_effective" ON "statutory_rule_versions" USING btree ("rule_type","effective_from");--> statement-breakpoint
ALTER TABLE "employees_leave_records" ADD CONSTRAINT "employees_leave_records_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE set null ON UPDATE no action;