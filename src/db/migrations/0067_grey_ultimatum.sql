CREATE TABLE "employee_weekly_shift_pattern_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern_id" integer NOT NULL,
	"weekday" "rest_day" NOT NULL,
	"shift_table_id" integer,
	"shift_name" varchar(80),
	"shift_code" varchar(40),
	"check_in_time" time,
	"check_out_time" time,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"paid_break_minutes" integer DEFAULT 0 NOT NULL,
	"hours_per_day" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_weekly_shift_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_weekly_shift_pattern_days" ADD CONSTRAINT "employee_weekly_shift_pattern_days_pattern_id_employee_weekly_shift_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."employee_weekly_shift_patterns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_weekly_shift_pattern_days" ADD CONSTRAINT "employee_weekly_shift_pattern_days_shift_table_id_shift_tables_id_fk" FOREIGN KEY ("shift_table_id") REFERENCES "public"."shift_tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_weekly_shift_patterns" ADD CONSTRAINT "employee_weekly_shift_patterns_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_employee_weekly_pattern_day_pattern_id" ON "employee_weekly_shift_pattern_days" USING btree ("pattern_id");--> statement-breakpoint
CREATE INDEX "idx_employee_weekly_pattern_day_shift_table_id" ON "employee_weekly_shift_pattern_days" USING btree ("shift_table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employee_weekly_pattern_day_weekday" ON "employee_weekly_shift_pattern_days" USING btree ("pattern_id","weekday");--> statement-breakpoint
CREATE INDEX "idx_employee_weekly_pattern_employee_id" ON "employee_weekly_shift_patterns" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_employee_weekly_pattern_effective_from" ON "employee_weekly_shift_patterns" USING btree ("effective_from");