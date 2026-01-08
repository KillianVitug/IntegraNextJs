ALTER TABLE "department" ADD COLUMN "code" varchar(50);--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_code_unique" UNIQUE("code");--> statement-breakpoint