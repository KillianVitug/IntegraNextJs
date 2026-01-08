CREATE TYPE "public"."leave_status" AS ENUM('Pending', 'Approved', 'Denied');--> statement-breakpoint
ALTER TABLE "employees_leave_records" RENAME COLUMN "approved" TO "leave_status";--> statement-breakpoint
ALTER TABLE "department" ALTER COLUMN "id" SET DATA TYPE integer;