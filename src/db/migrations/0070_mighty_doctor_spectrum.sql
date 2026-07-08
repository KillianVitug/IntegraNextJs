ALTER TABLE "employees_loans" ADD COLUMN "term_months" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "loan_installments" ADD COLUMN "skipped_at" timestamp;--> statement-breakpoint
ALTER TABLE "loan_installments" ADD COLUMN "skipped_by_user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "loan_installments" ADD COLUMN "skip_reason" text;