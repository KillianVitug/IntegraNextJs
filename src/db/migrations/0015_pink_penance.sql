CREATE TABLE "employees_salary_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"payroll_code" varchar(50) NOT NULL,
	"old_daily_rate" numeric(10, 2),
	"old_monthly_rate" numeric(10, 2),
	"old_monthly_allowance" numeric(10, 2),
	"old_daily_allowance" numeric(10, 2),
	"old_rate_divisor" numeric(10, 2),
	"old_billing_rate" numeric(10, 2),
	"new_daily_rate" numeric(10, 2),
	"new_monthly_rate" numeric(10, 2),
	"new_monthly_allowance" numeric(10, 2),
	"new_daily_allowance" numeric(10, 2),
	"new_rate_divisor" numeric(10, 2),
	"new_billing_rate" numeric(10, 2),
	"adjustment_date" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "employees_leave_balances" CASCADE;--> statement-breakpoint
ALTER TABLE "employees_salary_adjustments" ADD CONSTRAINT "employees_salary_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_salary_adjustment_employee_id" ON "employees_salary_adjustments" USING btree ("employee_id");