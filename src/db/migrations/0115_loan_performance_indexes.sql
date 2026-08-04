CREATE INDEX IF NOT EXISTS "idx_employees_loans_employee_account_status_deleted" ON "employees_loans" USING btree ("employee_id","account_Code","loan_status_enum","deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_loan_installment_code_status_loan" ON "loan_installments" USING btree ("payroll_code","status","loan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_loan_installment_period_status" ON "loan_installments" USING btree ("payroll_period_id","status");
