CREATE TABLE "auth_account_permission_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_permission_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_account_permission_groups" ADD CONSTRAINT "auth_account_permission_groups_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account_permission_groups" ADD CONSTRAINT "auth_account_permission_groups_group_id_auth_permission_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."auth_permission_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_account_permission_groups_account_id" ON "auth_account_permission_groups" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_auth_account_permission_groups_group_id" ON "auth_account_permission_groups" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_auth_account_permission_group" ON "auth_account_permission_groups" USING btree ("account_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_auth_permission_groups_key" ON "auth_permission_groups" USING btree ("key");
--> statement-breakpoint
INSERT INTO "auth_permission_groups" ("key", "name", "description", "is_system")
VALUES
	('SYSTEM_ADMIN', 'System Admin', 'Full system access, including account lifecycle and access management.', true),
	('HR_ADMIN', 'HR Admin', 'Operational HR and payroll access, including payroll processing and approvals.', true),
	('EMPLOYEE', 'Employee', 'Employee self-service access.', true)
ON CONFLICT ("key") DO UPDATE SET
	"name" = EXCLUDED."name",
	"description" = EXCLUDED."description",
	"is_system" = EXCLUDED."is_system",
	"updated_at" = now();
--> statement-breakpoint
INSERT INTO "auth_account_permission_groups" ("account_id", "group_id")
SELECT
	aa."id",
	apg."id"
FROM "auth_accounts" aa
INNER JOIN "employees" e
	ON e."id" = aa."employee_id"
LEFT JOIN "employees_general_info" egi
	ON egi."employee_id" = e."id"
INNER JOIN "auth_permission_groups" apg
	ON apg."key" = CASE
		WHEN egi."confidentiality_level" = 'Managerial' THEN 'SYSTEM_ADMIN'
		WHEN egi."confidentiality_level" = 'Supervisory' THEN 'HR_ADMIN'
		WHEN egi."confidentiality_level" = 'Rank and File' THEN 'EMPLOYEE'
		ELSE NULL
	END
WHERE e."deleted_at" IS NULL
ON CONFLICT ("account_id", "group_id") DO NOTHING;
