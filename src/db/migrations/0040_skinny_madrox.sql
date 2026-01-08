CREATE TABLE "employee_folder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"folder_name" varchar(100) NOT NULL,
	"employee_file_type_enum" "employee_file_type_enum" NOT NULL,
	"description" text,
	"remarks" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "employees_files" RENAME TO "employee_files";--> statement-breakpoint
ALTER TABLE "employee_files" DROP CONSTRAINT "employees_files_employee_id_employees_id_fk";
--> statement-breakpoint
DROP INDEX "idx_employee_files_employee_id";--> statement-breakpoint
ALTER TABLE "employee_files" ALTER COLUMN "file_path" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "employee_files" ALTER COLUMN "file_extension" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "employee_files" ALTER COLUMN "file_size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_folder" ADD CONSTRAINT "employee_folder_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_files" ADD CONSTRAINT "employee_files_group_id_employee_folder_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."employee_folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_files" DROP COLUMN "employee_id";--> statement-breakpoint
ALTER TABLE "employee_files" DROP COLUMN "employee_file_type_enum";--> statement-breakpoint
ALTER TABLE "employee_files" DROP COLUMN "is_archived";