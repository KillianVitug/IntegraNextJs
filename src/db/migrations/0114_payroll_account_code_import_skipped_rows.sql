CREATE TABLE "payroll_account_code_import_skipped_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"source_line" integer NOT NULL,
	"payroll_period_code" varchar(80),
	"employee_no" varchar(80),
	"account_code" varchar(80),
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_account_code_import_skipped_rows" ADD CONSTRAINT "payroll_account_code_import_skipped_rows_batch_id_payroll_account_code_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payroll_account_code_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payroll_account_code_import_skipped_batch" ON "payroll_account_code_import_skipped_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_account_code_import_skipped_source_line" ON "payroll_account_code_import_skipped_rows" USING btree ("batch_id","source_line");
