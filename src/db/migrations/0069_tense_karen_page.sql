CREATE TYPE "public"."overtime_category_enum" AS ENUM('REGULAR_DAY', 'REST_DAY', 'REGULAR_HOLIDAY', 'REST_DAY_REGULAR_HOLIDAY', 'SPECIAL_NON_WORKING_HOLIDAY', 'REST_DAY_SPECIAL_NON_WORKING_HOLIDAY');--> statement-breakpoint
CREATE TABLE "employee_daily_overtime_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"manual_minutes" integer,
	"category" "overtime_category_enum" NOT NULL,
	"remarks" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "idx_overtime_rule_minutes_from";--> statement-breakpoint
ALTER TABLE "overtime_rules" ADD COLUMN "category" "overtime_category_enum";--> statement-breakpoint
UPDATE "overtime_rules" SET "category" = 'REGULAR_DAY' WHERE "category" IS NULL;--> statement-breakpoint
ALTER TABLE "overtime_rules" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_daily_overtime_overrides" ADD CONSTRAINT "employee_daily_overtime_overrides_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employee_daily_overtime_override" ON "employee_daily_overtime_overrides" USING btree ("employee_id","attendance_date");--> statement-breakpoint
CREATE INDEX "idx_employee_daily_overtime_override_date" ON "employee_daily_overtime_overrides" USING btree ("attendance_date");--> statement-breakpoint
CREATE INDEX "idx_overtime_rule_category_minutes_from" ON "overtime_rules" USING btree ("category","minutes_from");
