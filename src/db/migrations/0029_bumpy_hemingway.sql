

ALTER TABLE "employees_loans" ADD CONSTRAINT "employees_loans_account_Code_accountCode_id_fk" FOREIGN KEY ("account_Code") REFERENCES "public"."accountCode"("id") ON DELETE set null ON UPDATE no action;