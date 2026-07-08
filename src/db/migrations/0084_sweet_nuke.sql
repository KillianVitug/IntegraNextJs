CREATE TABLE "manual_payroll_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" uuid NOT NULL,
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
	"sss_employee" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"sss_employer" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"sss_ec" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"sss_basis" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"philhealth_employee" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"philhealth_employer" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"philhealth_basis" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"pagibig_employee" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"pagibig_employer" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"pagibig_basis" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"withholding_tax" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"withholding_tax_basis" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"peraa_employee" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"peraa_employer" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"peraa_basis" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"remarks" text,
	"created_by_user_id" varchar(255),
	"updated_by_user_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_payroll_entry_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manual_payroll_entry_id" uuid NOT NULL,
	"account_code_id" integer,
	"line_type" "payroll_line_type" NOT NULL,
	"summary_bucket" varchar(40) NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" varchar(150) NOT NULL,
	"loan_ref_no" varchar(80),
	"hours" integer DEFAULT 0 NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"taxable" boolean DEFAULT false NOT NULL,
	"month_13th_eligible" boolean DEFAULT false NOT NULL,
	"non_taxable" boolean DEFAULT false NOT NULL,
	"deminimis" boolean DEFAULT false NOT NULL,
	"source_table" varchar(50),
	"source_id" varchar(50),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manual_payroll_entries" ADD CONSTRAINT "manual_payroll_entries_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_payroll_entries" ADD CONSTRAINT "manual_payroll_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_payroll_entry_lines" ADD CONSTRAINT "manual_payroll_entry_lines_manual_payroll_entry_id_manual_payroll_entries_id_fk" FOREIGN KEY ("manual_payroll_entry_id") REFERENCES "public"."manual_payroll_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_payroll_entry_lines" ADD CONSTRAINT "manual_payroll_entry_lines_account_code_id_accountCode_id_fk" FOREIGN KEY ("account_code_id") REFERENCES "public"."accountCode"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_manual_payroll_entry_period_employee" ON "manual_payroll_entries" USING btree ("payroll_period_id","employee_id");--> statement-breakpoint
CREATE INDEX "idx_manual_payroll_entry_period" ON "manual_payroll_entries" USING btree ("payroll_period_id");--> statement-breakpoint
CREATE INDEX "idx_manual_payroll_entry_employee" ON "manual_payroll_entries" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_manual_payroll_entry_line_entry" ON "manual_payroll_entry_lines" USING btree ("manual_payroll_entry_id");--> statement-breakpoint
CREATE INDEX "idx_manual_payroll_entry_line_account" ON "manual_payroll_entry_lines" USING btree ("account_code_id");