ALTER TABLE "employee_folder" DROP CONSTRAINT "employee_folder_employee_id_employees_id_fk";
--> statement-breakpoint
ALTER TABLE "employee_folder" ALTER COLUMN "employee_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_folder" ADD CONSTRAINT "employee_folder_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."employees_general_info" ALTER COLUMN "confidentiality_level" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."confidentiality_level";--> statement-breakpoint
CREATE TYPE "public"."confidentiality_level" AS ENUM('Rank and File', 'Supervisory', 'Managerial');--> statement-breakpoint
ALTER TABLE "public"."employees_general_info" ALTER COLUMN "confidentiality_level" SET DATA TYPE "public"."confidentiality_level" USING "confidentiality_level"::"public"."confidentiality_level";--> statement-breakpoint
ALTER TABLE "public"."employees_general_info" ALTER COLUMN "employment_status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."employment_status";--> statement-breakpoint
CREATE TYPE "public"."employment_status" AS ENUM('Regular', 'Probationary', 'Contractual', 'Finished Conctract', 'Resigned', 'Temporary', 'Terminated');--> statement-breakpoint
ALTER TABLE "public"."employees_general_info" ALTER COLUMN "employment_status" SET DATA TYPE "public"."employment_status" USING "employment_status"::"public"."employment_status";