CREATE TABLE "accountCode" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_Type" varchar(50) NOT NULL,
	"account_Code" varchar(50) NOT NULL,
	"description" varchar(80),
	"daily_rate" numeric(10, 2),
	"monthly_rate" numeric(10, 2),
	"month_13th_pay" boolean DEFAULT false NOT NULL,
	"non_taxable" boolean DEFAULT false NOT NULL,
	"deminimis" boolean DEFAULT false NOT NULL,
	"health_insurance" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees_loans" ADD COLUMN "account_Code" integer;--> statement-breakpoint
ALTER TABLE "employees_loans" ADD CONSTRAINT "employees_loans_account_Code_accountCode_id_fk" FOREIGN KEY ("account_Code") REFERENCES "public"."accountCode"("id") ON DELETE set null ON UPDATE no action;