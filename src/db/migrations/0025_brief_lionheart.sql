CREATE TABLE "department" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"code" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "department_name_unique" UNIQUE("name"),
	CONSTRAINT "department_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "employees_general_info" ADD COLUMN "department_id" integer;--> statement-breakpoint
ALTER TABLE "employees_general_info" ADD CONSTRAINT "employees_general_info_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE set null ON UPDATE no action;