ALTER TABLE "manual_payroll_entries" ADD COLUMN "pay_computation_mode" varchar(20);--> statement-breakpoint
ALTER TABLE "manual_payroll_entries" ADD COLUMN "baseline_snapshot" jsonb;