CREATE TYPE "public"."auth_account_status" AS ENUM('PendingSetup', 'Active', 'Locked', 'Disabled');--> statement-breakpoint
CREATE TYPE "public"."auth_otp_purpose" AS ENUM('Onboarding', 'Login');--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text,
	"status" "auth_account_status" DEFAULT 'PendingSetup' NOT NULL,
	"must_set_password" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_accounts_employee_id_unique" UNIQUE("employee_id"),
	CONSTRAINT "auth_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_admin_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"invite_token_hash" varchar(64) NOT NULL,
	"confidentiality_level" "confidentiality_level" NOT NULL,
	"invited_by_account_id" uuid,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_admin_invites_invite_token_hash_unique" UNIQUE("invite_token_hash")
);
--> statement-breakpoint
CREATE TABLE "auth_email_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"purpose" "auth_otp_purpose" NOT NULL,
	"otp_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_password_setup_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_password_setup_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"session_token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_seen_at" timestamp,
	"revoked_at" timestamp,
	"ip_address" varchar(100),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_session_token_hash_unique" UNIQUE("session_token_hash")
);
--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_kinde_user_id_unique";--> statement-breakpoint
ALTER TABLE "employees_other_references" ALTER COLUMN "email" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_admin_invites" ADD CONSTRAINT "auth_admin_invites_invited_by_account_id_auth_accounts_id_fk" FOREIGN KEY ("invited_by_account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_email_otps" ADD CONSTRAINT "auth_email_otps_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_password_setup_tokens" ADD CONSTRAINT "auth_password_setup_tokens_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_accounts_status" ON "auth_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_auth_accounts_employee_id" ON "auth_accounts" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_auth_admin_invites_email" ON "auth_admin_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_auth_admin_invites_expires_at" ON "auth_admin_invites" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_auth_email_otps_account_id" ON "auth_email_otps" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_auth_email_otps_purpose" ON "auth_email_otps" USING btree ("purpose");--> statement-breakpoint
CREATE INDEX "idx_auth_password_setup_tokens_account_id" ON "auth_password_setup_tokens" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_account_id" ON "auth_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_expires_at" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employee_reference_email_active" ON "employees_other_references" USING btree ("email") WHERE "employees_other_references"."email" is not null and "employees_other_references"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "kinde_user_id";