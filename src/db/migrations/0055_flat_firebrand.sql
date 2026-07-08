ALTER TABLE "employee_contribution_flags" ADD COLUMN "schedule_always" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_contribution_flags" ADD COLUMN "schedule_end_of_month" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_contribution_flags" ADD COLUMN "schedule_first_payroll" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_contribution_flags" ADD COLUMN "schedule_second_payroll" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_contribution_flags" ADD COLUMN "schedule_third_payroll" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_contribution_flags" ADD COLUMN "schedule_forth_payroll" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees_salary_adjustments" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "employee_contribution_groups" DROP COLUMN "schedule";