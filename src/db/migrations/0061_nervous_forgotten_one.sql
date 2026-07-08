CREATE TYPE "public"."payroll_run_event_type" AS ENUM('Computed', 'MarkedStale', 'Reviewed', 'Approved', 'Posted', 'Voided');--> statement-breakpoint
CREATE TABLE "admin_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" varchar(255) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" varchar(80),
	"action" varchar(120) NOT NULL,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"event_type" "payroll_run_event_type" NOT NULL,
	"from_status" "payroll_run_status",
	"to_status" "payroll_run_status",
	"actor_user_id" varchar(255) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "computed_by_user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "reviewed_by_user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "approved_by_user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "posted_by_user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "voided_by_user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "reversal_run_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_run_events" ADD CONSTRAINT "payroll_run_events_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_audit_created_at" ON "admin_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_entity" ON "admin_audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_run_event_run_id" ON "payroll_run_events" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_run_event_type" ON "payroll_run_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_attendance_batch_period_hash" ON "attendance_import_batches" USING btree ("payroll_period_id","source_hash") WHERE "attendance_import_batches"."source_hash" is not null;--> statement-breakpoint
CREATE INDEX "idx_attendance_raw_logs_normalized_hash" ON "attendance_raw_logs" USING btree ("normalized_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_loan_payment_payroll_installment" ON "loan_payments" USING btree ("installment_id","source") WHERE "loan_payments"."installment_id" is not null and "loan_payments"."source" = 'Payroll';