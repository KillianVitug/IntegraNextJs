ALTER TYPE "public"."salary_change_event_type" ADD VALUE 'AppliedPermanent';--> statement-breakpoint
ALTER TYPE "public"."salary_change_status" ADD VALUE 'AppliedPermanent';--> statement-breakpoint
ALTER TABLE "employee_salary_changes" ADD COLUMN "applied_permanent_at" timestamp;