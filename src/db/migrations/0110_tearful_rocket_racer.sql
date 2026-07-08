ALTER TABLE "holiday_year_calendar" ADD COLUMN IF NOT EXISTS "check_date_1" date;--> statement-breakpoint
ALTER TABLE "holiday_year_calendar" ADD COLUMN IF NOT EXISTS "check_date_2" date;--> statement-breakpoint
ALTER TABLE "holiday_year_calendar" ADD COLUMN IF NOT EXISTS "require_check_date_1" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "holiday_year_calendar" ADD COLUMN IF NOT EXISTS "require_check_date_2" boolean DEFAULT false NOT NULL;
