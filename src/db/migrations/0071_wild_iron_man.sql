CREATE INDEX "idx_attendance_raw_logs_batch_date_employee_time" ON "attendance_raw_logs" USING btree ("batch_id","log_date","employee_id","logged_at");--> statement-breakpoint
CREATE INDEX "idx_shift_assignment_employee_effective_range" ON "employee_shift_assignments" USING btree ("employee_id","effective_from","effective_to");--> statement-breakpoint
CREATE INDEX "idx_employee_weekly_pattern_employee_effective_range" ON "employee_weekly_shift_patterns" USING btree ("employee_id","effective_from","effective_to");--> statement-breakpoint
CREATE INDEX "idx_leave_record_employee_status_date" ON "employees_leave_records" USING btree ("employee_id","leave_status","date_filed");--> statement-breakpoint
CREATE INDEX "idx_loan_installment_code_status" ON "loan_installments" USING btree ("payroll_code","status");--> statement-breakpoint
CREATE INDEX "idx_payroll_run_employee_run_employee" ON "payroll_run_employees" USING btree ("payroll_run_id","employee_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_run_line_employee_code" ON "payroll_run_lines" USING btree ("payroll_run_employee_id","code");