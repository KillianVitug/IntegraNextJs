DO $$ BEGIN
	CREATE TYPE "public"."payroll_exception_type" AS ENUM('OVERTIME', 'WORKED_DAY_PREMIUM', 'NON_WORKED_HOLIDAY');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."payroll_exception_worked_status" AS ENUM('WORKED', 'NON_WORKED');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_payroll_exception_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"exception_type" "payroll_exception_type" NOT NULL,
	"worked_status" "payroll_exception_worked_status" NOT NULL,
	"day_type" "attendance_dtr_day_type" NOT NULL,
	"custom_payroll_code_id" integer,
	"payroll_code_snapshot" varchar(50) NOT NULL,
	"overtime_category" "overtime_category_enum",
	"quantity_minutes" integer,
	"quantity_days" numeric(6, 2),
	"amount_override" numeric(12, 2),
	"remarks" text,
	"legacy_overtime_override_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_payroll_exception_rows" ADD CONSTRAINT "employee_payroll_exception_rows_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_payroll_exception_rows" ADD CONSTRAINT "employee_payroll_exception_rows_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_payroll_exception_rows" ADD CONSTRAINT "employee_payroll_exception_rows_custom_payroll_code_id_custom_payroll_definitions_id_fk" FOREIGN KEY ("custom_payroll_code_id") REFERENCES "public"."custom_payroll_definitions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_payroll_exception_rows" ADD CONSTRAINT "employee_payroll_exception_rows_legacy_overtime_override_id_employee_daily_overtime_overrides_id_fk" FOREIGN KEY ("legacy_overtime_override_id") REFERENCES "public"."employee_daily_overtime_overrides"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_employee_payroll_exception_row" ON "employee_payroll_exception_rows" USING btree ("payroll_period_id","employee_id","attendance_date","exception_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_employee_payroll_exception_period_employee" ON "employee_payroll_exception_rows" USING btree ("payroll_period_id","employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_employee_payroll_exception_date" ON "employee_payroll_exception_rows" USING btree ("attendance_date");
--> statement-breakpoint
INSERT INTO "employee_payroll_exception_rows" (
	"payroll_period_id",
	"employee_id",
	"attendance_date",
	"exception_type",
	"worked_status",
	"day_type",
	"payroll_code_snapshot",
	"overtime_category",
	"quantity_minutes",
	"remarks",
	"legacy_overtime_override_id",
	"created_at",
	"updated_at"
)
SELECT
	pp."id",
	ot."employee_id",
	ot."attendance_date",
	'OVERTIME'::"payroll_exception_type",
	'WORKED'::"payroll_exception_worked_status",
	CASE
		WHEN ot."category" IN ('REGULAR_HOLIDAY', 'REST_DAY_REGULAR_HOLIDAY')
			THEN 'Legal/Regular Holiday'::"attendance_dtr_day_type"
		WHEN ot."category" IN ('SPECIAL_NON_WORKING_HOLIDAY', 'REST_DAY_SPECIAL_NON_WORKING_HOLIDAY')
			THEN 'Special Non-Working Holiday'::"attendance_dtr_day_type"
		ELSE 'Regular Day'::"attendance_dtr_day_type"
	END,
	'OT',
	ot."category",
	COALESCE(
		ot."manual_minutes",
		GREATEST(
			0,
			COALESCE(ads."overtime_minutes", 0),
			COALESCE(ot."worked_minutes_override", ads."worked_minutes", 0) - 480
		)
	),
	ot."remarks",
	ot."id",
	ot."created_at",
	ot."updated_at"
FROM "employee_daily_overtime_overrides" ot
INNER JOIN "payroll_periods" pp
	ON ot."attendance_date" >= pp."start_date"
	AND ot."attendance_date" <= pp."end_date"
	AND pp."payroll_terms" = 'Semi-Monthly'::"payroll_terms"
LEFT JOIN "attendance_daily_summaries" ads
	ON ads."employee_id" = ot."employee_id"
	AND ads."attendance_date" = ot."attendance_date"
WHERE ot."is_approved" = true
ON CONFLICT ("payroll_period_id", "employee_id", "attendance_date", "exception_type") DO NOTHING;
