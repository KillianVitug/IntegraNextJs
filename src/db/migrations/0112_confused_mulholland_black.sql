CREATE TABLE "branch_calendar_schedule_override_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendance_date" date NOT NULL,
	"mode" varchar(40) NOT NULL,
	"shift_table_id" integer,
	"created_by_user_id" uuid,
	"reverted_at" timestamp,
	"reverted_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_calendar_schedule_override_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"mutation_type" varchar(40) NOT NULL,
	"original_assignment_id" integer,
	"applied_assignment_id" integer NOT NULL,
	"retained_assignment_id" integer,
	"after_fragment_assignment_id" integer,
	"stale_start_date" date NOT NULL,
	"stale_end_date" date,
	"previous_assignment_snapshot" jsonb,
	"applied_assignment_snapshot" jsonb NOT NULL,
	"retained_assignment_snapshot" jsonb,
	"after_fragment_assignment_snapshot" jsonb,
	"reverted_at" timestamp,
	"reverted_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branch_calendar_schedule_override_batches" ADD CONSTRAINT "branch_calendar_schedule_override_batches_shift_table_id_shift_tables_id_fk" FOREIGN KEY ("shift_table_id") REFERENCES "public"."shift_tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_calendar_schedule_override_batches" ADD CONSTRAINT "branch_calendar_schedule_override_batches_created_by_user_id_auth_accounts_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."auth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_calendar_schedule_override_batches" ADD CONSTRAINT "branch_calendar_schedule_override_batches_reverted_by_user_id_auth_accounts_id_fk" FOREIGN KEY ("reverted_by_user_id") REFERENCES "public"."auth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_calendar_schedule_override_items" ADD CONSTRAINT "branch_calendar_schedule_override_items_batch_id_branch_calendar_schedule_override_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."branch_calendar_schedule_override_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_calendar_schedule_override_items" ADD CONSTRAINT "branch_calendar_schedule_override_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_calendar_schedule_override_items" ADD CONSTRAINT "branch_calendar_schedule_override_items_reverted_by_user_id_auth_accounts_id_fk" FOREIGN KEY ("reverted_by_user_id") REFERENCES "public"."auth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_branch_calendar_schedule_override_batch_date" ON "branch_calendar_schedule_override_batches" USING btree ("attendance_date");--> statement-breakpoint
CREATE INDEX "idx_branch_calendar_schedule_override_batch_created_by" ON "branch_calendar_schedule_override_batches" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "idx_branch_calendar_schedule_override_item_batch" ON "branch_calendar_schedule_override_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_branch_calendar_schedule_override_item_employee_date" ON "branch_calendar_schedule_override_items" USING btree ("employee_id","attendance_date");--> statement-breakpoint
CREATE INDEX "idx_branch_calendar_schedule_override_item_applied" ON "branch_calendar_schedule_override_items" USING btree ("applied_assignment_id");--> statement-breakpoint
CREATE INDEX "idx_branch_calendar_schedule_override_item_reverted" ON "branch_calendar_schedule_override_items" USING btree ("reverted_at");
