ALTER TABLE "accountCode" ALTER COLUMN "daily_rate" SET DATA TYPE numeric(10, 4);--> statement-breakpoint
ALTER TABLE "accountCode" ALTER COLUMN "monthly_rate" SET DATA TYPE numeric(10, 4);--> statement-breakpoint
ALTER TABLE "employee_salary_changes" ALTER COLUMN "before_daily_rate" SET DATA TYPE numeric(10, 4);--> statement-breakpoint
ALTER TABLE "employee_salary_changes" ALTER COLUMN "before_monthly_rate" SET DATA TYPE numeric(10, 4);--> statement-breakpoint
ALTER TABLE "employee_salary_changes" ALTER COLUMN "after_daily_rate" SET DATA TYPE numeric(10, 4);--> statement-breakpoint
ALTER TABLE "employee_salary_changes" ALTER COLUMN "after_monthly_rate" SET DATA TYPE numeric(10, 4);--> statement-breakpoint
ALTER TABLE "employees_salary" ALTER COLUMN "daily_rate" SET DATA TYPE numeric(10, 4);--> statement-breakpoint
ALTER TABLE "employees_salary" ALTER COLUMN "monthly_rate" SET DATA TYPE numeric(10, 4);--> statement-breakpoint
ALTER TABLE "employees_salary_adjustments" ALTER COLUMN "old_daily_rate" SET DATA TYPE numeric(10, 4);--> statement-breakpoint
ALTER TABLE "employees_salary_adjustments" ALTER COLUMN "old_monthly_rate" SET DATA TYPE numeric(10, 4);--> statement-breakpoint
ALTER TABLE "employees_salary_adjustments" ALTER COLUMN "new_daily_rate" SET DATA TYPE numeric(10, 4);--> statement-breakpoint
ALTER TABLE "employees_salary_adjustments" ALTER COLUMN "new_monthly_rate" SET DATA TYPE numeric(10, 4);