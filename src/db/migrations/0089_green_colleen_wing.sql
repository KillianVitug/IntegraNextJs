CREATE TYPE "public"."leave_approval_event_action" AS ENUM('Submitted', 'Updated', 'Approved', 'ApprovedWithOverride', 'Denied', 'Cancelled', 'Voided');--> statement-breakpoint
CREATE TYPE "public"."leave_day_part" AS ENUM('FullDay', 'AM', 'PM');--> statement-breakpoint
CREATE TYPE "public"."leave_encashment_status" AS ENUM('Pending', 'Approved', 'Denied', 'Void');--> statement-breakpoint
CREATE TYPE "public"."leave_policy_grant_model" AS ENUM('Annual');--> statement-breakpoint
ALTER TYPE "public"."leave_ledger_transaction" ADD VALUE 'Encashment';--> statement-breakpoint
ALTER TYPE "public"."leave_status" ADD VALUE 'Cancelled';--> statement-breakpoint
ALTER TYPE "public"."leave_status" ADD VALUE 'Voided';--> statement-breakpoint
CREATE TABLE "employee_leave_approval_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leave_record_id" integer NOT NULL,
	"actor_user_id" varchar(255),
	"action" "leave_approval_event_action" NOT NULL,
	"old_status" "leave_status",
	"new_status" "leave_status",
	"decision_note" text,
	"override_reason" text,
	"balance_before" numeric(6, 2),
	"projected_balance" numeric(6, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_leave_record_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"leave_record_id" integer NOT NULL,
	"leave_date" date NOT NULL,
	"day_part" "leave_day_part" DEFAULT 'FullDay' NOT NULL,
	"quantity" numeric(4, 2) DEFAULT '0.00' NOT NULL,
	"is_rest_day" boolean DEFAULT false NOT NULL,
	"holiday_type" "holiday_type_enum",
	"exclusion_reason" varchar(80),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_encashments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" integer NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"quantity" numeric(5, 2) NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" "leave_encashment_status" DEFAULT 'Pending' NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"month_13th_eligible" boolean DEFAULT false NOT NULL,
	"account_code_id" integer,
	"requested_by_user_id" varchar(255),
	"approved_by_user_id" varchar(255),
	"approved_at" timestamp,
	"denied_by_user_id" varchar(255),
	"denied_at" timestamp,
	"decision_note" text,
	"balance_before" numeric(6, 2),
	"projected_balance" numeric(6, 2),
	"manual_payroll_entry_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"leave_type_id" integer NOT NULL,
	"grant_model" "leave_policy_grant_model" DEFAULT 'Annual' NOT NULL,
	"carryover_limit" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"expiry_month" integer DEFAULT 12 NOT NULL,
	"expiry_day" integer DEFAULT 31 NOT NULL,
	"encashment_enabled" boolean DEFAULT false NOT NULL,
	"encashment_taxable" boolean DEFAULT true NOT NULL,
	"encashment_month_13th_eligible" boolean DEFAULT false NOT NULL,
	"encashment_account_code_id" integer,
	"half_day_allowed" boolean DEFAULT true NOT NULL,
	"exclude_rest_days_and_holidays" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "leave_policies_leave_type_id_unique" UNIQUE("leave_type_id")
);
--> statement-breakpoint
ALTER TABLE "leave_balance_ledger" ADD COLUMN "period_year" integer;--> statement-breakpoint
ALTER TABLE "leave_balance_ledger" ADD COLUMN "idempotency_key" varchar(140);--> statement-breakpoint
ALTER TABLE "employee_leave_approval_events" ADD CONSTRAINT "employee_leave_approval_events_leave_record_id_employees_leave_records_id_fk" FOREIGN KEY ("leave_record_id") REFERENCES "public"."employees_leave_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_leave_record_days" ADD CONSTRAINT "employee_leave_record_days_leave_record_id_employees_leave_records_id_fk" FOREIGN KEY ("leave_record_id") REFERENCES "public"."employees_leave_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_account_code_id_accountCode_id_fk" FOREIGN KEY ("account_code_id") REFERENCES "public"."accountCode"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_manual_payroll_entry_id_manual_payroll_entries_id_fk" FOREIGN KEY ("manual_payroll_entry_id") REFERENCES "public"."manual_payroll_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_encashment_account_code_id_accountCode_id_fk" FOREIGN KEY ("encashment_account_code_id") REFERENCES "public"."accountCode"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_employee_leave_approval_event_record" ON "employee_leave_approval_events" USING btree ("leave_record_id");--> statement-breakpoint
CREATE INDEX "idx_employee_leave_approval_event_actor" ON "employee_leave_approval_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employee_leave_record_day" ON "employee_leave_record_days" USING btree ("leave_record_id","leave_date");--> statement-breakpoint
CREATE INDEX "idx_employee_leave_record_day_record" ON "employee_leave_record_days" USING btree ("leave_record_id");--> statement-breakpoint
CREATE INDEX "idx_employee_leave_record_day_date" ON "employee_leave_record_days" USING btree ("leave_date");--> statement-breakpoint
CREATE INDEX "idx_leave_encashment_employee" ON "leave_encashments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_leave_encashment_leave_type" ON "leave_encashments" USING btree ("leave_type_id");--> statement-breakpoint
CREATE INDEX "idx_leave_encashment_period" ON "leave_encashments" USING btree ("payroll_period_id");--> statement-breakpoint
CREATE INDEX "idx_leave_policy_leave_type" ON "leave_policies" USING btree ("leave_type_id");--> statement-breakpoint
CREATE INDEX "idx_leave_policy_encashment_account" ON "leave_policies" USING btree ("encashment_account_code_id");--> statement-breakpoint
CREATE INDEX "idx_leave_ledger_employee_leave_type_year" ON "leave_balance_ledger" USING btree ("employee_id","leave_type_id","period_year");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_leave_ledger_idempotency_key" ON "leave_balance_ledger" USING btree ("idempotency_key") WHERE "leave_balance_ledger"."idempotency_key" is not null;