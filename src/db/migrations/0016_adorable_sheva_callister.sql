CREATE TYPE "public"."loan_status" AS ENUM('Always');--> statement-breakpoint
CREATE TABLE "accountCode" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"description" varchar(80),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accountCode_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "employees_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"account_Code" integer,
	"loan_reference_number" varchar(50) NOT NULL,
	"amount_granted" numeric(10, 2) NOT NULL,
	"loan_payroll_deduction" varchar(50) NOT NULL,
	"loan_date" date NOT NULL,
	"loan_payment_terms" "loan_status",
	"payable_loan" varchar(50) NOT NULL,
	"loan_balance" numeric(10, 2) NOT NULL,
	"amortization" varchar(50) NOT NULL,
	"loan_payment_date" date NOT NULL,
	"loan_status" "recurring_status",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "employees_loans" ADD CONSTRAINT "employees_loans_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees_loans" ADD CONSTRAINT "employees_loans_account_Code_accountCode_id_fk" FOREIGN KEY ("account_Code") REFERENCES "public"."accountCode"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_employee_id" ON "employees_loans" USING btree ("employee_id");