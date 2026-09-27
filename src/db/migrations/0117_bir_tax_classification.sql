CREATE TYPE "public"."bir_tax_category" AS ENUM('RegularTaxable', 'SupplementalTaxable', 'ThirteenthMonthOtherBenefits', 'DeMinimis', 'NonTaxable');--> statement-breakpoint
CREATE TYPE "public"."bir_de_minimis_type" AS ENUM('MonetizedLeavePrivate', 'MedicalCashAllowance', 'RiceSubsidy', 'UniformClothing', 'MedicalBenefits', 'LaundryAllowance', 'EmployeeAchievementAward', 'ChristmasMajorAnniversaryGift', 'OvertimeMealAllowance');--> statement-breakpoint
ALTER TABLE "accountCode" ADD COLUMN "bir_tax_category" "bir_tax_category";--> statement-breakpoint
ALTER TABLE "accountCode" ADD COLUMN "bir_de_minimis_type" "bir_de_minimis_type";--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD COLUMN "bir_tax_category" "bir_tax_category";--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD COLUMN "bir_de_minimis_type" "bir_de_minimis_type";--> statement-breakpoint
ALTER TABLE "manual_payroll_entry_lines" ADD COLUMN "bir_tax_category" "bir_tax_category";--> statement-breakpoint
ALTER TABLE "manual_payroll_entry_lines" ADD COLUMN "bir_de_minimis_type" "bir_de_minimis_type";
