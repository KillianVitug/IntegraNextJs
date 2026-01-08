CREATE TYPE "public"."employee_file_type_enum" AS ENUM('Admin', 'Leave', 'Performance', 'Payroll', 'Compliance', 'Medical', 'Training', 'Travel', 'Disciplinary', 'Assets', 'OffBoarding', 'Other');--> statement-breakpoint
CREATE TABLE "employees_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"description" text,
	"remarks" text,
	"employee_file_type_enum" "employee_file_type_enum" NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_path" varchar(255) NOT NULL,
	"file_extension" varchar(10),
	"mime_type" varchar(100),
	"file_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees_files" ADD CONSTRAINT "employees_files_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_employee_files_employee_id" ON "employees_files" USING btree ("employee_id");