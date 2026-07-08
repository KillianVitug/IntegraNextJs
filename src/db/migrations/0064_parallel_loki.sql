DROP INDEX "idx_attendance_daily_employee_date";--> statement-breakpoint
ALTER TABLE "attendance_daily_summaries" ADD COLUMN "scheduled_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_attendance_daily_employee_date" ON "attendance_daily_summaries" USING btree ("employee_id","attendance_date");