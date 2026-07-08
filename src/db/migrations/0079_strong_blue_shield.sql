CREATE TYPE "public"."holiday_template_recurrence_enum" AS ENUM('FixedDate', 'NthWeekday', 'ManualAnnual');--> statement-breakpoint
CREATE TYPE "public"."holiday_year_source_enum" AS ENUM('Generated', 'Manual', 'Backfill');--> statement-breakpoint
CREATE TYPE "public"."holiday_year_status_enum" AS ENUM('Draft', 'Confirmed');--> statement-breakpoint
CREATE TABLE "holiday_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"holiday_type" "holiday_type_enum" NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"recurrence_type" "holiday_template_recurrence_enum" DEFAULT 'FixedDate' NOT NULL,
	"fixed_month" integer,
	"fixed_day" integer,
	"nth_month" integer,
	"nth_weekday" integer,
	"nth_occurrence" integer,
	"duration_days" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holiday_year_calendar" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"template_id" integer,
	"source" "holiday_year_source_enum" DEFAULT 'Manual' NOT NULL,
	"name" varchar(150) NOT NULL,
	"holiday_date" date,
	"holiday_date_2" date,
	"holiday_type" "holiday_type_enum" NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"status" "holiday_year_status_enum" DEFAULT 'Draft' NOT NULL,
	"notes" text,
	"generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holiday_year_calendar" ADD CONSTRAINT "holiday_year_calendar_template_id_holiday_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."holiday_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_holiday_templates_active" ON "holiday_templates" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_holiday_templates_name" ON "holiday_templates" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_holiday_year_calendar_year" ON "holiday_year_calendar" USING btree ("year");--> statement-breakpoint
CREATE INDEX "idx_holiday_year_calendar_date" ON "holiday_year_calendar" USING btree ("holiday_date");--> statement-breakpoint
CREATE INDEX "idx_holiday_year_calendar_status" ON "holiday_year_calendar" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_holiday_year_calendar_year_template" ON "holiday_year_calendar" USING btree ("year","template_id") WHERE "holiday_year_calendar"."template_id" is not null;
--> statement-breakpoint
INSERT INTO "holiday_templates" (
	"name",
	"holiday_type",
	"is_paid",
	"is_active",
	"recurrence_type",
	"fixed_month",
	"fixed_day",
	"duration_days",
	"notes",
	"created_at",
	"updated_at"
)
SELECT DISTINCT ON (
	lower(trim("name")),
	"holiday_type",
	"is_paid",
	extract(month from "holiday_date")::int,
	extract(day from "holiday_date")::int,
	greatest(1, (coalesce("holiday_date_2", "holiday_date") - "holiday_date") + 1)
)
	"name",
	"holiday_type",
	"is_paid",
	true,
	'FixedDate',
	extract(month from "holiday_date")::int,
	extract(day from "holiday_date")::int,
	greatest(1, (coalesce("holiday_date_2", "holiday_date") - "holiday_date") + 1),
	'Backfilled from legacy holiday calendar. Review recurrence before using for future years.',
	"created_at",
	"updated_at"
FROM "holiday_calendar"
WHERE "holiday_date" IS NOT NULL
ORDER BY
	lower(trim("name")),
	"holiday_type",
	"is_paid",
	extract(month from "holiday_date")::int,
	extract(day from "holiday_date")::int,
	greatest(1, (coalesce("holiday_date_2", "holiday_date") - "holiday_date") + 1),
	"holiday_date";
--> statement-breakpoint
INSERT INTO "holiday_year_calendar" (
	"year",
	"template_id",
	"source",
	"name",
	"holiday_date",
	"holiday_date_2",
	"holiday_type",
	"is_paid",
	"status",
	"notes",
	"generated_at",
	"created_at",
	"updated_at"
)
SELECT
	extract(year from legacy."holiday_date")::int,
	template."id",
	'Backfill',
	legacy."name",
	legacy."holiday_date",
	legacy."holiday_date_2",
	legacy."holiday_type",
	legacy."is_paid",
	'Confirmed',
	'Backfilled from legacy holiday calendar.',
	now(),
	legacy."created_at",
	legacy."updated_at"
FROM "holiday_calendar" legacy
LEFT JOIN "holiday_templates" template
	ON lower(trim(template."name")) = lower(trim(legacy."name"))
	AND template."holiday_type" = legacy."holiday_type"
	AND template."is_paid" = legacy."is_paid"
	AND template."recurrence_type" = 'FixedDate'
	AND template."fixed_month" = extract(month from legacy."holiday_date")::int
	AND template."fixed_day" = extract(day from legacy."holiday_date")::int
	AND template."duration_days" = greatest(1, (coalesce(legacy."holiday_date_2", legacy."holiday_date") - legacy."holiday_date") + 1)
WHERE legacy."holiday_date" IS NOT NULL
ON CONFLICT DO NOTHING;
