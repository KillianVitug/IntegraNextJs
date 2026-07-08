CREATE TYPE "public"."manager_schedule_request_action" AS ENUM('Create', 'Update', 'Delete');--> statement-breakpoint
CREATE TYPE "public"."manager_schedule_request_status" AS ENUM('Pending', 'Approved', 'Denied', 'Cancelled');--> statement-breakpoint
CREATE TABLE "auth_manager_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"department_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_schedule_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by_account_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"target_assignment_id" integer,
	"action" "manager_schedule_request_action" NOT NULL,
	"status" "manager_schedule_request_status" DEFAULT 'Pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text,
	"decision_note" text,
	"decided_by_account_id" uuid,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_manager_departments" ADD CONSTRAINT "auth_manager_departments_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_manager_departments" ADD CONSTRAINT "auth_manager_departments_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_schedule_change_requests" ADD CONSTRAINT "manager_schedule_change_requests_requested_by_account_id_auth_accounts_id_fk" FOREIGN KEY ("requested_by_account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_schedule_change_requests" ADD CONSTRAINT "manager_schedule_change_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_schedule_change_requests" ADD CONSTRAINT "manager_schedule_change_requests_target_assignment_id_employee_shift_assignments_id_fk" FOREIGN KEY ("target_assignment_id") REFERENCES "public"."employee_shift_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_schedule_change_requests" ADD CONSTRAINT "manager_schedule_change_requests_decided_by_account_id_auth_accounts_id_fk" FOREIGN KEY ("decided_by_account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_manager_departments_account_id" ON "auth_manager_departments" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_auth_manager_departments_department_id" ON "auth_manager_departments" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_auth_manager_department" ON "auth_manager_departments" USING btree ("account_id","department_id");--> statement-breakpoint
CREATE INDEX "idx_manager_schedule_request_requester" ON "manager_schedule_change_requests" USING btree ("requested_by_account_id");--> statement-breakpoint
CREATE INDEX "idx_manager_schedule_request_employee" ON "manager_schedule_change_requests" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_manager_schedule_request_status" ON "manager_schedule_change_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_manager_schedule_request_created_at" ON "manager_schedule_change_requests" USING btree ("created_at");
