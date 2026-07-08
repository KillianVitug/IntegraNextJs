CREATE TABLE "branch_calendar_account_code_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"attendance_date" date NOT NULL,
	"department_id" integer,
	"regular_account_code_id" integer NOT NULL,
	"overtime_account_code_id" integer NOT NULL,
	"created_by_user_id" varchar(255),
	"updated_by_user_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branch_calendar_account_code_overrides" ADD CONSTRAINT "branch_calendar_account_code_overrides_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "branch_calendar_account_code_overrides" ADD CONSTRAINT "branch_calendar_account_code_overrides_regular_account_code_id_accountCode_id_fk" FOREIGN KEY ("regular_account_code_id") REFERENCES "public"."accountCode"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "branch_calendar_account_code_overrides" ADD CONSTRAINT "branch_calendar_account_code_overrides_overtime_account_code_id_accountCode_id_fk" FOREIGN KEY ("overtime_account_code_id") REFERENCES "public"."accountCode"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_branch_calendar_account_codes_all_departments" ON "branch_calendar_account_code_overrides" USING btree ("attendance_date") WHERE "department_id" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_branch_calendar_account_codes_department" ON "branch_calendar_account_code_overrides" USING btree ("attendance_date","department_id") WHERE "department_id" is not null;
--> statement-breakpoint
CREATE INDEX "idx_branch_calendar_account_codes_date" ON "branch_calendar_account_code_overrides" USING btree ("attendance_date");
--> statement-breakpoint
CREATE INDEX "idx_branch_calendar_account_codes_department" ON "branch_calendar_account_code_overrides" USING btree ("department_id");
--> statement-breakpoint
CREATE INDEX "idx_branch_calendar_account_codes_regular" ON "branch_calendar_account_code_overrides" USING btree ("regular_account_code_id");
--> statement-breakpoint
CREATE INDEX "idx_branch_calendar_account_codes_overtime" ON "branch_calendar_account_code_overrides" USING btree ("overtime_account_code_id");
