ALTER TYPE "public"."recurring_frequency" ADD VALUE 'Other';--> statement-breakpoint
ALTER TABLE "public"."employees_recurring_entries" ALTER COLUMN "recurring_status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."recurring_status";--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('Active', 'Paid');--> statement-breakpoint
ALTER TABLE "public"."employees_recurring_entries" ALTER COLUMN "recurring_status" SET DATA TYPE "public"."recurring_status" USING "recurring_status"::"public"."recurring_status";