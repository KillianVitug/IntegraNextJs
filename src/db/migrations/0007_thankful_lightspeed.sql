CREATE TYPE "public"."leave_type" AS ENUM('SL', 'VL');--> statement-breakpoint
CREATE TABLE "employees_leave_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"vacation_leave" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"sick_leave" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "employees_leave_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"date_filed" date NOT NULL,
	"leave_type" "leave_type" NOT NULL,
	"no_of_days" numeric(4, 2) NOT NULL,
	"reason" text,
	"approved" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "slvl_group" ADD COLUMN "default_vacation_leave" numeric(5, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "slvl_group" ADD COLUMN "default_sick_leave" numeric(5, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees_leave_balances" ADD CONSTRAINT "employees_leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees_leave_records" ADD CONSTRAINT "employees_leave_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_leave_balance_employee_id" ON "employees_leave_balances" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_leave_balance_year" ON "employees_leave_balances" USING btree ("year");--> statement-breakpoint
CREATE INDEX "idx_leave_record_employee_id" ON "employees_leave_records" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_leave_record_date" ON "employees_leave_records" USING btree ("date_filed");