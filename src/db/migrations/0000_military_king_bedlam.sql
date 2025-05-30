CREATE TYPE "public"."category" AS ENUM('Daily', 'Weekly', 'Monthly', 'Other');--> statement-breakpoint
CREATE TYPE "public"."civil_status" AS ENUM('Single', 'Married');--> statement-breakpoint
CREATE TYPE "public"."confidentiality_level" AS ENUM('Rank and File', 'Manager', 'Executive');--> statement-breakpoint
CREATE TYPE "public"."employment_status" AS ENUM('Active', 'Resigned', 'Terminated');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('Once', 'Daily', 'Weekly', 'Monthly', 'Yearly');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('Male', 'Female');--> statement-breakpoint
CREATE TYPE "public"."payroll_mode" AS ENUM('Bank', 'Cash');--> statement-breakpoint
CREATE TYPE "public"."payroll_terms" AS ENUM('Daily', 'Weekly', 'Bi-Weekly', 'Semi-Monthly', 'Monthly');--> statement-breakpoint
CREATE TYPE "public"."rest_day" AS ENUM('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday');--> statement-breakpoint
CREATE TYPE "public"."shift_schedule" AS ENUM('Morning', 'Afternoon', 'Night', 'Other');--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('active', 'paid');--> statement-breakpoint
CREATE TYPE "public"."tax_status" AS ENUM('S', 'ME', 'ME1-S1', 'ME2-S2', 'ME3-S3', 'ME4-S4');--> statement-breakpoint
CREATE TABLE "department" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "department_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_no" varchar(50) NOT NULL,
	"first_name" varchar(50) NOT NULL,
	"last_name" varchar(50) NOT NULL,
	"middle_name" varchar(50),
	"suffix" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false,
	CONSTRAINT "employees_employee_no_unique" UNIQUE("employee_no")
);
--> statement-breakpoint
CREATE TABLE "employees_general_info" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"date_hired" date,
	"separation_date" date,
	"tax_id_number" varchar(20),
	"sss_number" varchar(20),
	"philhealth_number" varchar(20),
	"payroll_mode" "payroll_mode",
	"payroll_terms" "payroll_terms",
	"category" "category",
	"department_id" integer,
	"employment_status" "employment_status",
	"confidentiality_level" "confidentiality_level",
	"clearance_date" date,
	"tax_status" varchar(20),
	"perra_id_number" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "employees_other_references" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"bank_code" varchar(50),
	"bank_account_no" varchar(50),
	"position_id" integer,
	"address" text,
	"telephone_no" varchar(20),
	"birthday" date,
	"age" integer,
	"civil_status" "civil_status",
	"gender" "gender",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "employees_recurring_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"account_code" varchar(50),
	"description" text,
	"amount" numeric(10, 2) NOT NULL,
	"recurring_frequency" "recurring_frequency",
	"recurring_status" "recurring_status",
	"start_date" date,
	"end_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "employees_salary" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"daily_rate" numeric(10, 2),
	"monthly_rate" numeric(10, 2),
	"monthly_allowance" numeric(10, 2),
	"daily_allowance" numeric(10, 2),
	"cola" numeric(10, 2),
	"rate_divisor" integer,
	"billing_rate" numeric(10, 2),
	"custom_payroll_code" varchar(50),
	"custom_payroll_description" text,
	"slvl_group_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "employees_timekeeping" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"timekeeping_id" varchar(50),
	"shift_schedule" "shift_schedule",
	"check_in_time" time,
	"check_out_time" time,
	"rest_day" "rest_day",
	"hours_worked" numeric(5, 2),
	"minutes_worked" numeric(5, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "position" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "position_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "slvl_group" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slvl_group_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "employees_general_info" ADD CONSTRAINT "employees_general_info_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees_general_info" ADD CONSTRAINT "employees_general_info_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees_other_references" ADD CONSTRAINT "employees_other_references_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees_other_references" ADD CONSTRAINT "employees_other_references_position_id_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."position"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees_recurring_entries" ADD CONSTRAINT "employees_recurring_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees_salary" ADD CONSTRAINT "employees_salary_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees_salary" ADD CONSTRAINT "employees_salary_slvl_group_id_slvl_group_id_fk" FOREIGN KEY ("slvl_group_id") REFERENCES "public"."slvl_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees_timekeeping" ADD CONSTRAINT "employees_timekeeping_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_employee_no" ON "employees" USING btree ("employee_no");--> statement-breakpoint
CREATE INDEX "idx_general_employee_id" ON "employees_general_info" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_references_employee_id" ON "employees_other_references" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_entries_employee_id" ON "employees_recurring_entries" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_salary_employee_id" ON "employees_salary" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_timekeeping_employee_id" ON "employees_timekeeping" USING btree ("employee_id");