
ALTER TABLE "employees" ADD COLUMN "kinde_user_id" varchar(50);--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_kinde_user_id_unique" UNIQUE("kinde_user_id");