CREATE TABLE "holiday_type_account_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"holiday_type" "holiday_type_enum" NOT NULL,
	"account_code_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holiday_type_account_codes" ADD CONSTRAINT "holiday_type_account_codes_account_code_id_accountCode_id_fk" FOREIGN KEY ("account_code_id") REFERENCES "public"."accountCode"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_holiday_type_account_codes_type" ON "holiday_type_account_codes" USING btree ("holiday_type");--> statement-breakpoint
CREATE INDEX "idx_holiday_type_account_codes_account" ON "holiday_type_account_codes" USING btree ("account_code_id");
