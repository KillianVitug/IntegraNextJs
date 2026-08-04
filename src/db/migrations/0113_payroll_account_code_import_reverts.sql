CREATE TABLE "payroll_account_code_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"source_file_name" varchar(255) NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"inserted_row_count" integer DEFAULT 0 NOT NULL,
	"updated_row_count" integer DEFAULT 0 NOT NULL,
	"skipped_period_mismatch_count" integer DEFAULT 0 NOT NULL,
	"skipped_invalid_row_count" integer DEFAULT 0 NOT NULL,
	"affected_employee_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"reverted_at" timestamp,
	"reverted_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_account_code_import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"applied_row_id" uuid NOT NULL,
	"mutation_type" varchar(20) NOT NULL,
	"previous_row_snapshot" jsonb,
	"applied_row_snapshot" jsonb NOT NULL,
	"reverted_at" timestamp,
	"reverted_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_account_code_import_batches" ADD CONSTRAINT "payroll_account_code_import_batches_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_account_code_import_batches" ADD CONSTRAINT "payroll_account_code_import_batches_created_by_user_id_auth_accounts_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."auth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_account_code_import_batches" ADD CONSTRAINT "payroll_account_code_import_batches_reverted_by_user_id_auth_accounts_id_fk" FOREIGN KEY ("reverted_by_user_id") REFERENCES "public"."auth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_account_code_import_items" ADD CONSTRAINT "payroll_account_code_import_items_batch_id_payroll_account_code_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payroll_account_code_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_account_code_import_items" ADD CONSTRAINT "payroll_account_code_import_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_account_code_import_items" ADD CONSTRAINT "payroll_account_code_import_items_reverted_by_user_id_auth_accounts_id_fk" FOREIGN KEY ("reverted_by_user_id") REFERENCES "public"."auth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payroll_account_code_import_batch_period" ON "payroll_account_code_import_batches" USING btree ("payroll_period_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_account_code_import_batch_reverted" ON "payroll_account_code_import_batches" USING btree ("reverted_at");--> statement-breakpoint
CREATE INDEX "idx_payroll_account_code_import_batch_created_by" ON "payroll_account_code_import_batches" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_account_code_import_item_batch" ON "payroll_account_code_import_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_account_code_import_item_employee" ON "payroll_account_code_import_items" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_account_code_import_item_applied_row" ON "payroll_account_code_import_items" USING btree ("applied_row_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_account_code_import_item_reverted" ON "payroll_account_code_import_items" USING btree ("reverted_at");
