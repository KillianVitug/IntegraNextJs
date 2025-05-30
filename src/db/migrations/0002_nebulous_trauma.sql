ALTER TABLE "employees" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "employees_general_info" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "employees_other_references" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "employees_recurring_entries" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "employees_salary" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "employees_timekeeping" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "is_deleted";--> statement-breakpoint
ALTER TABLE "employees_general_info" DROP COLUMN "is_deleted";--> statement-breakpoint
ALTER TABLE "employees_other_references" DROP COLUMN "is_deleted";--> statement-breakpoint
ALTER TABLE "employees_recurring_entries" DROP COLUMN "is_deleted";--> statement-breakpoint
ALTER TABLE "employees_salary" DROP COLUMN "is_deleted";--> statement-breakpoint
ALTER TABLE "employees_timekeeping" DROP COLUMN "is_deleted";