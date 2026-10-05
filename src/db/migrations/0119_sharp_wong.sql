CREATE TYPE "public"."payroll_artifact_kind" AS ENUM('Payslip', 'PayrollRegister', 'BankFile', 'CashPayrollList', 'GlJournal', 'SssContribution', 'SssLoan', 'PhilhealthEprs', 'PagibigMcrf', 'Bir1601C', 'Bir1604C', 'Bir2316', 'Dole13thMonth', 'Other');--> statement-breakpoint
CREATE TYPE "public"."payroll_artifact_status" AS ENUM('Draft', 'Generated', 'Published', 'Submitted', 'Paid', 'Voided');--> statement-breakpoint
CREATE TYPE "public"."payroll_disbursement_status" AS ENUM('Draft', 'Generated', 'Approved', 'Released', 'Reconciled', 'Voided');--> statement-breakpoint
CREATE TYPE "public"."payroll_export_format" AS ENUM('CSV', 'XLSX', 'PDF', 'TXT', 'JSON');--> statement-breakpoint
CREATE TYPE "public"."payroll_journal_status" AS ENUM('Draft', 'Balanced', 'Posted', 'Reversed', 'Voided');--> statement-breakpoint
CREATE TYPE "public"."payroll_policy_status" AS ENUM('Draft', 'Validated', 'Published', 'Retired');--> statement-breakpoint
CREATE TYPE "public"."payroll_readiness_severity" AS ENUM('Blocker', 'Warning');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_type" AS ENUM('Regular', 'OffCycle', 'FinalPay', 'Supplemental', 'Reversal', 'ThirteenthMonth');--> statement-breakpoint
CREATE TYPE "public"."payslip_publication_status" AS ENUM('Draft', 'Published', 'Revoked');--> statement-breakpoint
CREATE TYPE "public"."statutory_filing_status" AS ENUM('Draft', 'Generated', 'Submitted', 'Paid', 'Reconciled', 'Voided');--> statement-breakpoint
ALTER TYPE "public"."payroll_run_event_type" ADD VALUE IF NOT EXISTS 'Reversed';--> statement-breakpoint
ALTER TYPE "public"."payroll_run_event_type" ADD VALUE IF NOT EXISTS 'PayslipsPublished';--> statement-breakpoint
ALTER TYPE "public"."payroll_run_event_type" ADD VALUE IF NOT EXISTS 'Exported';--> statement-breakpoint
CREATE TABLE "employer_payroll_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" varchar(180) NOT NULL,
	"trade_name" varchar(180),
	"tin" varchar(30),
	"rdo_code" varchar(20),
	"registered_address" text,
	"sss_employer_number" varchar(40),
	"philhealth_employer_number" varchar(40),
	"pagibig_employer_number" varchar(40),
	"bank_funding_account_name" varchar(120),
	"bank_funding_account_number" varchar(80),
	"bank_funding_bank_code" "bank_code_type_enum",
	"payroll_signatory_name" varchar(120),
	"payroll_signatory_title" varchar(120),
	"timezone" varchar(80) DEFAULT 'Asia/Manila' NOT NULL,
	"currency" varchar(3) DEFAULT 'PHP' NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_by_user_id" varchar(255),
	"updated_by_user_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_tax_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"tax_status" "tax_status",
	"is_minimum_wage_earner" boolean DEFAULT false NOT NULL,
	"wage_region" varchar(80),
	"daily_minimum_wage" numeric(10, 2),
	"previous_employer_taxable_pay" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"previous_employer_tax_withheld" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"bir_2316_received" boolean DEFAULT false NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"notes" text,
	"created_by_user_id" varchar(255),
	"updated_by_user_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employee_tax_profiles_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
CREATE TABLE "employee_opening_year_to_date_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"tax_year" integer NOT NULL,
	"taxable_pay" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"non_taxable_pay" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"withholding_tax" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"sss_employee" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"philhealth_employee" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"pagibig_employee" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"source_note" text,
	"created_by_user_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_payroll_readiness_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"check_key" varchar(80) NOT NULL,
	"severity" "payroll_readiness_severity" NOT NULL,
	"message" text NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employer_profile_id" uuid,
	"code" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" "payroll_policy_status" DEFAULT 'Draft' NOT NULL,
	"payroll_terms" "payroll_terms" DEFAULT 'Semi-Monthly' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"deduction_priority" jsonb DEFAULT '["TAX","SSS","PHILHEALTH","PAGIBIG","LOAN","OTHER"]'::jsonb NOT NULL,
	"net_pay_floor" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"rounding_policy" jsonb,
	"overtime_policy" jsonb,
	"tardiness_policy" jsonb,
	"thirteenth_month_policy" jsonb,
	"final_pay_policy" jsonb,
	"created_by_user_id" varchar(255),
	"validated_at" timestamp,
	"validated_by_user_id" varchar(255),
	"published_at" timestamp,
	"published_by_user_id" varchar(255),
	"retired_at" timestamp,
	"retired_by_user_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_policy_versions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "statutory_rule_versions" ADD COLUMN "status" "payroll_policy_status" DEFAULT 'Published' NOT NULL;--> statement-breakpoint
ALTER TABLE "statutory_rule_versions" ADD COLUMN "official_source_label" varchar(180);--> statement-breakpoint
ALTER TABLE "statutory_rule_versions" ADD COLUMN "official_source_url" text;--> statement-breakpoint
ALTER TABLE "statutory_rule_versions" ADD COLUMN "validated_at" timestamp;--> statement-breakpoint
ALTER TABLE "statutory_rule_versions" ADD COLUMN "validated_by_user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "statutory_rule_versions" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
ALTER TABLE "statutory_rule_versions" ADD COLUMN "published_by_user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "statutory_rule_versions" ADD COLUMN "locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "run_type" "payroll_run_type" DEFAULT 'Regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "policy_version_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "idempotency_key" varchar(120);--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "input_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "calculation_trace" jsonb;--> statement-breakpoint
CREATE TABLE "payroll_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid,
	"payroll_run_employee_id" uuid,
	"kind" "payroll_artifact_kind" NOT NULL,
	"status" "payroll_artifact_status" DEFAULT 'Draft' NOT NULL,
	"format" "payroll_export_format",
	"storage_key" text,
	"file_name" varchar(255),
	"content_hash" varchar(128),
	"metadata" jsonb,
	"generated_by_user_id" varchar(255),
	"generated_at" timestamp,
	"published_by_user_id" varchar(255),
	"published_at" timestamp,
	"submitted_by_user_id" varchar(255),
	"submitted_at" timestamp,
	"voided_by_user_id" varchar(255),
	"voided_at" timestamp,
	"void_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslip_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_employee_id" uuid NOT NULL,
	"artifact_id" uuid,
	"status" "payslip_publication_status" DEFAULT 'Draft' NOT NULL,
	"published_by_user_id" varchar(255),
	"published_at" timestamp,
	"revoked_by_user_id" varchar(255),
	"revoked_at" timestamp,
	"revoke_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_disbursement_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"batch_type" varchar(20) NOT NULL,
	"status" "payroll_disbursement_status" DEFAULT 'Draft' NOT NULL,
	"bank_adapter" varchar(80),
	"employee_count" integer DEFAULT 0 NOT NULL,
	"total_net_pay" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"control_hash" varchar(128),
	"artifact_id" uuid,
	"approved_by_user_id" varchar(255),
	"approved_at" timestamp,
	"released_by_user_id" varchar(255),
	"released_at" timestamp,
	"reconciled_by_user_id" varchar(255),
	"reconciled_at" timestamp,
	"created_by_user_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_bank_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"disbursement_batch_id" uuid NOT NULL,
	"artifact_id" uuid,
	"bank_adapter" varchar(80) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"control_hash" varchar(128),
	"generated_by_user_id" varchar(255),
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_journal_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"status" "payroll_journal_status" DEFAULT 'Draft' NOT NULL,
	"total_debits" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"total_credits" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"artifact_id" uuid,
	"posted_by_user_id" varchar(255),
	"posted_at" timestamp,
	"reversed_by_user_id" varchar(255),
	"reversed_at" timestamp,
	"created_by_user_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_batch_id" uuid NOT NULL,
	"account_code" varchar(80) NOT NULL,
	"account_name" varchar(180) NOT NULL,
	"department_id" integer,
	"debit" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"credit" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"memo" text,
	"source_line_type" "payroll_line_type",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statutory_filing_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid,
	"employer_profile_id" uuid,
	"kind" "payroll_artifact_kind" NOT NULL,
	"status" "statutory_filing_status" DEFAULT 'Draft' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_date" date,
	"amount_due" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"artifact_id" uuid,
	"payment_reference" varchar(120),
	"receipt_artifact_id" uuid,
	"prepared_by_user_id" varchar(255),
	"submitted_by_user_id" varchar(255),
	"submitted_at" timestamp,
	"paid_by_user_id" varchar(255),
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_tax_profiles" ADD CONSTRAINT "employee_tax_profiles_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_opening_year_to_date_balances" ADD CONSTRAINT "employee_opening_year_to_date_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_payroll_readiness_checks" ADD CONSTRAINT "employee_payroll_readiness_checks_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_payroll_readiness_checks" ADD CONSTRAINT "employee_payroll_readiness_checks_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_policy_versions" ADD CONSTRAINT "payroll_policy_versions_employer_profile_id_employer_payroll_profiles_id_fk" FOREIGN KEY ("employer_profile_id") REFERENCES "public"."employer_payroll_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_policy_version_id_payroll_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."payroll_policy_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_artifacts" ADD CONSTRAINT "payroll_artifacts_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_artifacts" ADD CONSTRAINT "payroll_artifacts_payroll_run_employee_id_payroll_run_employees_id_fk" FOREIGN KEY ("payroll_run_employee_id") REFERENCES "public"."payroll_run_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_publications" ADD CONSTRAINT "payslip_publications_payroll_run_employee_id_payroll_run_employees_id_fk" FOREIGN KEY ("payroll_run_employee_id") REFERENCES "public"."payroll_run_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_publications" ADD CONSTRAINT "payslip_publications_artifact_id_payroll_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."payroll_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_disbursement_batches" ADD CONSTRAINT "payroll_disbursement_batches_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_disbursement_batches" ADD CONSTRAINT "payroll_disbursement_batches_artifact_id_payroll_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."payroll_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_bank_files" ADD CONSTRAINT "payroll_bank_files_disbursement_batch_id_payroll_disbursement_batches_id_fk" FOREIGN KEY ("disbursement_batch_id") REFERENCES "public"."payroll_disbursement_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_bank_files" ADD CONSTRAINT "payroll_bank_files_artifact_id_payroll_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."payroll_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_journal_batches" ADD CONSTRAINT "payroll_journal_batches_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_journal_batches" ADD CONSTRAINT "payroll_journal_batches_artifact_id_payroll_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."payroll_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_journal_lines" ADD CONSTRAINT "payroll_journal_lines_journal_batch_id_payroll_journal_batches_id_fk" FOREIGN KEY ("journal_batch_id") REFERENCES "public"."payroll_journal_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_journal_lines" ADD CONSTRAINT "payroll_journal_lines_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_filing_packages" ADD CONSTRAINT "statutory_filing_packages_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_filing_packages" ADD CONSTRAINT "statutory_filing_packages_employer_profile_id_employer_payroll_profiles_id_fk" FOREIGN KEY ("employer_profile_id") REFERENCES "public"."employer_payroll_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_filing_packages" ADD CONSTRAINT "statutory_filing_packages_artifact_id_payroll_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."payroll_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_filing_packages" ADD CONSTRAINT "statutory_filing_packages_receipt_artifact_id_payroll_artifacts_id_fk" FOREIGN KEY ("receipt_artifact_id") REFERENCES "public"."payroll_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employer_payroll_profile_default" ON "employer_payroll_profiles" USING btree ("is_default") WHERE "employer_payroll_profiles"."is_default" = true;--> statement-breakpoint
CREATE INDEX "idx_employer_payroll_profile_legal_name" ON "employer_payroll_profiles" USING btree ("legal_name");--> statement-breakpoint
CREATE INDEX "idx_employee_tax_profile_employee" ON "employee_tax_profiles" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_employee_tax_profile_effective" ON "employee_tax_profiles" USING btree ("employee_id","effective_from","effective_to");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employee_opening_ytd_year" ON "employee_opening_year_to_date_balances" USING btree ("employee_id","tax_year");--> statement-breakpoint
CREATE INDEX "idx_employee_opening_ytd_employee" ON "employee_opening_year_to_date_balances" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_employee_payroll_readiness_period" ON "employee_payroll_readiness_checks" USING btree ("payroll_period_id");--> statement-breakpoint
CREATE INDEX "idx_employee_payroll_readiness_employee" ON "employee_payroll_readiness_checks" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employee_payroll_readiness_check" ON "employee_payroll_readiness_checks" USING btree ("payroll_period_id","employee_id","check_key");--> statement-breakpoint
CREATE INDEX "idx_payroll_policy_status" ON "payroll_policy_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payroll_policy_effective" ON "payroll_policy_versions" USING btree ("payroll_terms","effective_from","effective_to");--> statement-breakpoint
CREATE INDEX "idx_payroll_run_type_status" ON "payroll_runs" USING btree ("run_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payroll_run_idempotency_key" ON "payroll_runs" USING btree ("idempotency_key") WHERE "payroll_runs"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payroll_run_posted_regular_period" ON "payroll_runs" USING btree ("payroll_period_id") WHERE "payroll_runs"."run_type" = 'Regular' and "payroll_runs"."status" = 'Posted';--> statement-breakpoint
CREATE INDEX "idx_payroll_artifact_run" ON "payroll_artifacts" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_artifact_employee_run" ON "payroll_artifacts" USING btree ("payroll_run_employee_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_artifact_kind_status" ON "payroll_artifacts" USING btree ("kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payslip_publication_employee_run" ON "payslip_publications" USING btree ("payroll_run_employee_id");--> statement-breakpoint
CREATE INDEX "idx_payslip_publication_status" ON "payslip_publications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payroll_disbursement_run" ON "payroll_disbursement_batches" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_disbursement_status" ON "payroll_disbursement_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payroll_bank_file_batch" ON "payroll_bank_files" USING btree ("disbursement_batch_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_journal_run" ON "payroll_journal_batches" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_journal_status" ON "payroll_journal_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payroll_journal_line_batch" ON "payroll_journal_lines" USING btree ("journal_batch_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_journal_line_account" ON "payroll_journal_lines" USING btree ("account_code");--> statement-breakpoint
CREATE INDEX "idx_statutory_filing_run" ON "statutory_filing_packages" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "idx_statutory_filing_kind_status" ON "statutory_filing_packages" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "idx_statutory_filing_due_date" ON "statutory_filing_packages" USING btree ("due_date");
