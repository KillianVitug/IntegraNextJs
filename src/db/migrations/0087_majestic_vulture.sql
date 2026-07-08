CREATE TABLE "auth_temporary_password_reveals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"encrypted_password" text NOT NULL,
	"iv" varchar(32) NOT NULL,
	"auth_tag" varchar(32) NOT NULL,
	"purpose" varchar(80) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revealed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_temporary_password_reveals" ADD CONSTRAINT "auth_temporary_password_reveals_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_temporary_password_reveals_account_id" ON "auth_temporary_password_reveals" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_auth_temporary_password_reveals_expires_at" ON "auth_temporary_password_reveals" USING btree ("expires_at");