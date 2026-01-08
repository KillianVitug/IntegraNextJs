CREATE TYPE "public"."basis_of_computation" AS ENUM('Gross Pay', 'Actual Basic Pay', 'Monthly Rate', 'Fixed Monthly Salary', 'Fixed Contribution');--> statement-breakpoint
CREATE TYPE "public"."contribution_type" AS ENUM('SSS', 'PHILHEALTH', 'PAGIBIG', 'PERAA', 'TAX');--> statement-breakpoint
CREATE TYPE "public"."payroll_schedule" AS ENUM('Always', 'First Payroll', 'Second Payroll', 'Third Payroll', 'Fourth Payroll', 'End Of Month');--> statement-breakpoint
CREATE TABLE "custom_payroll_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" text,
	"rate_divisor" numeric(10, 2),
	"hourly_rate_divisor" numeric(10, 2),
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "custom_payroll_definitions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "employee_contribution_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"pagibig_max_contribution" boolean DEFAULT false,
	"pagibig_deduct_share" boolean DEFAULT false,
	"peraa_compute_both" boolean DEFAULT false,
	"peraa_compute_employer" boolean DEFAULT false,
	"tax_fixed_percentage" boolean DEFAULT false,
	"tax_fixed_value" numeric(10, 2),
	"tax_month_end_adjustment" boolean DEFAULT false,
	"sss_use_actual" boolean DEFAULT false,
	"philhealth_minimum_bracket" boolean DEFAULT false,
	"flag1" boolean,
	"flag2" boolean,
	"flag3" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employee_contribution_flags_group_id_unique" UNIQUE("group_id")
);
--> statement-breakpoint
CREATE TABLE "employee_contribution_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"payroll_code" varchar NOT NULL,
	"contribution_type" "contribution_type" NOT NULL,
	"schedule" "payroll_schedule" NOT NULL,
	"basis_of_computation" "basis_of_computation" NOT NULL,
	"basis_value" numeric(10, 2),
	"approximation_percent" numeric(5, 2) DEFAULT '100' NOT NULL,
	"percentage" numeric(5, 4),
	"fixed_amount" numeric(10, 2),
	"minimum" numeric(10, 2),
	"maximum" numeric(10, 2),
	"fixed_employee_share" numeric(10, 2) DEFAULT '0',
	"fixed_employer_share" numeric(10, 2) DEFAULT '0',
	"fixed_ec_share" numeric(10, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_custom_payroll" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"custom_payroll_id" integer NOT NULL,
	"effective_date" date,
	"end_date" date,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "employee_contribution_flags" ADD CONSTRAINT "employee_contribution_flags_group_id_employee_contribution_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."employee_contribution_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contribution_groups" ADD CONSTRAINT "employee_contribution_groups_payroll_code_custom_payroll_definitions_code_fk" FOREIGN KEY ("payroll_code") REFERENCES "public"."custom_payroll_definitions"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_custom_payroll" ADD CONSTRAINT "employee_custom_payroll_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_custom_payroll" ADD CONSTRAINT "employee_custom_payroll_custom_payroll_id_custom_payroll_definitions_id_fk" FOREIGN KEY ("custom_payroll_id") REFERENCES "public"."custom_payroll_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees_salary" ADD CONSTRAINT "employees_salary_custom_payroll_code_custom_payroll_definitions_code_fk" FOREIGN KEY ("custom_payroll_code") REFERENCES "public"."custom_payroll_definitions"("code") ON DELETE set null ON UPDATE no action;