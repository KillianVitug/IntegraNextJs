CREATE TABLE "overtime_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"minutes_from" integer NOT NULL,
	"minutes_to" integer,
	"rate_multiplier" numeric(8, 4) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tardiness_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"minutes_from" integer NOT NULL,
	"minutes_to" integer,
	"rate_multiplier" numeric(8, 4) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "undertime_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"minutes_from" integer NOT NULL,
	"minutes_to" integer,
	"rate_multiplier" numeric(8, 4) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holiday_calendar" ADD COLUMN "holiday_date_2" date;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "account_code_id" integer;--> statement-breakpoint
CREATE INDEX "idx_overtime_rule_minutes_from" ON "overtime_rules" USING btree ("minutes_from");--> statement-breakpoint
CREATE INDEX "idx_tardiness_rule_minutes_from" ON "tardiness_rules" USING btree ("minutes_from");--> statement-breakpoint
CREATE INDEX "idx_undertime_rule_minutes_from" ON "undertime_rules" USING btree ("minutes_from");--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_account_code_id_accountCode_id_fk" FOREIGN KEY ("account_code_id") REFERENCES "public"."accountCode"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_calendar" DROP COLUMN "location_code";