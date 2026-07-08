CREATE TYPE "public"."employee_type" AS ENUM('EMP', 'ADMIN');--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_employee_no_unique";--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "employee_type" "employee_type" DEFAULT 'EMP' NOT NULL;--> statement-breakpoint
UPDATE "employees" AS "e"
SET "employee_type" = 'ADMIN'
FROM "employees_general_info" AS "egi"
WHERE "egi"."employee_id" = "e"."id"
  AND "egi"."confidentiality_level" IN ('Supervisory', 'Managerial');--> statement-breakpoint
CREATE UNIQUE INDEX "employees_employee_type_no_unique" ON "employees" USING btree ("employee_type","employee_no");
