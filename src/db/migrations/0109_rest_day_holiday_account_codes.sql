ALTER TABLE "holiday_type_account_codes" ADD COLUMN "rest_day_account_code_id" integer;--> statement-breakpoint
ALTER TABLE "holiday_type_account_codes" ADD COLUMN "rest_day_overtime_account_code_id" integer;--> statement-breakpoint
ALTER TABLE "holiday_type_account_codes" ADD CONSTRAINT "holiday_type_account_codes_rest_day_account_code_id_accountCode_id_fk" FOREIGN KEY ("rest_day_account_code_id") REFERENCES "public"."accountCode"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_type_account_codes" ADD CONSTRAINT "holiday_type_account_codes_rest_day_overtime_account_code_id_accountCode_id_fk" FOREIGN KEY ("rest_day_overtime_account_code_id") REFERENCES "public"."accountCode"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_holiday_type_account_codes_rest_day_account" ON "holiday_type_account_codes" USING btree ("rest_day_account_code_id");--> statement-breakpoint
CREATE INDEX "idx_holiday_type_account_codes_rest_day_overtime_account" ON "holiday_type_account_codes" USING btree ("rest_day_overtime_account_code_id");
