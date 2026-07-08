-- ALTER TABLE "employees_salary" RENAME COLUMN "custom_payroll_code" TO "custom_payroll_id";--> statement-breakpoint
-- ALTER TABLE "employees_salary" DROP CONSTRAINT "employees_salary_custom_payroll_code_custom_payroll_definitions_code_fk";
-- --> statement-breakpoint
-- ALTER TABLE "employees_salary" ADD CONSTRAINT "employees_salary_custom_payroll_id_custom_payroll_definitions_id_fk" FOREIGN KEY ("custom_payroll_id") REFERENCES "public"."custom_payroll_definitions"("id") ON DELETE set null ON UPDATE no action;

-- 1️⃣ Drop old FK (already correct)
ALTER TABLE "employees_salary"
DROP CONSTRAINT IF EXISTS "employees_salary_custom_payroll_code_custom_payroll_definitions_code_fk";

-- 2️⃣ Rename column
ALTER TABLE "employees_salary"
RENAME COLUMN "custom_payroll_code" TO "custom_payroll_id";

-- 3️⃣ Convert VARCHAR → INTEGER
ALTER TABLE "employees_salary"
ALTER COLUMN "custom_payroll_id"
TYPE INTEGER
USING NULLIF(custom_payroll_id, '')::INTEGER;

-- 4️⃣ Add correct FK
ALTER TABLE "employees_salary"
ADD CONSTRAINT "employees_salary_custom_payroll_id_custom_payroll_definitions_id_fk"
FOREIGN KEY ("custom_payroll_id")
REFERENCES "custom_payroll_definitions"("id")
ON DELETE SET NULL;