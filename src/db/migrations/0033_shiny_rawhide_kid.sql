ALTER TABLE "employees_loans" ALTER COLUMN "loan_payment_terms" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "employees_loans" DROP COLUMN "loan_status";