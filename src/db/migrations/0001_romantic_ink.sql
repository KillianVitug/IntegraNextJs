ALTER TABLE "employees_general_info" ADD CONSTRAINT "employees_general_info_employee_id_unique" UNIQUE("employee_id");--> statement-breakpoint
ALTER TABLE "employees_other_references" ADD CONSTRAINT "employees_other_references_employee_id_unique" UNIQUE("employee_id");--> statement-breakpoint
ALTER TABLE "employees_salary" ADD CONSTRAINT "employees_salary_employee_id_unique" UNIQUE("employee_id");--> statement-breakpoint
ALTER TABLE "employees_timekeeping" ADD CONSTRAINT "employees_timekeeping_employee_id_unique" UNIQUE("employee_id");