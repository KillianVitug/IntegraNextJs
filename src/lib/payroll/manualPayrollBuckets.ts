import type { ManualPayrollLineSummaryBucket } from "@/app/(ntg)/payroll/types";

const MANUAL_PAYROLL_ACCOUNT_TYPE_BUCKETS = new Map<
  string,
  ManualPayrollLineSummaryBucket
>([
  ["Regular Hours", "basicPay"],
  ["Overtime", "otPaidLeaves"],
  ["Night Premium", "otPaidLeaves"],
  ["Sunday/Holiday", "otPaidLeaves"],
  ["Paid Leaves", "otPaidLeaves"],
  ["Other Income", "otherIncome"],
  ["Loan", "otherDeductions"],
  ["Other Deduction", "otherDeductions"],
  ["Unpaid Leaves/Absences", "otherDeductions"],
]);

const MANUAL_PAYROLL_ACCOUNT_CODE_BUCKETS = new Map<
  string,
  ManualPayrollLineSummaryBucket
>([["2-201", "otPaidLeaves"]]);

function normalizeManualPayrollAccountCode(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

export function getManualPayrollBucketFromAccountType(
  accountType: string | null | undefined
): ManualPayrollLineSummaryBucket | null;
export function getManualPayrollBucketFromAccountType(
  accountType: string | null | undefined,
  fallback: ManualPayrollLineSummaryBucket
): ManualPayrollLineSummaryBucket;
export function getManualPayrollBucketFromAccountType(
  accountType: string | null | undefined,
  fallback: ManualPayrollLineSummaryBucket | null = null
) {
  return MANUAL_PAYROLL_ACCOUNT_TYPE_BUCKETS.get(accountType ?? "") ?? fallback;
}

export function getManualPayrollBucketFromAccountCodeOrType(
  args: {
    code: string | null | undefined;
    accountType: string | null | undefined;
  }
): ManualPayrollLineSummaryBucket | null;
export function getManualPayrollBucketFromAccountCodeOrType(
  args: {
    code: string | null | undefined;
    accountType: string | null | undefined;
  },
  fallback: ManualPayrollLineSummaryBucket
): ManualPayrollLineSummaryBucket;
export function getManualPayrollBucketFromAccountCodeOrType(
  args: {
    code: string | null | undefined;
    accountType: string | null | undefined;
  },
  fallback: ManualPayrollLineSummaryBucket | null = null
) {
  const accountCodeBucket = MANUAL_PAYROLL_ACCOUNT_CODE_BUCKETS.get(
    normalizeManualPayrollAccountCode(args.code)
  );
  if (accountCodeBucket) return accountCodeBucket;

  return MANUAL_PAYROLL_ACCOUNT_TYPE_BUCKETS.get(args.accountType ?? "") ?? fallback;
}
