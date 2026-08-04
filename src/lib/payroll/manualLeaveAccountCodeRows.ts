import type { PayrollManualLeaveAccountCodeRowView } from "@/app/(ntg)/payroll/types";
import type { PayrollExceptionAccountType } from "./payrollExceptions";

export const MANUAL_PAYROLL_LEAVE_SOURCE_TABLE = "employees_leave_records";
export const MANUAL_PAYROLL_LEAVE_SOURCE_LABEL = "Manual Payroll leave";
export const APPROVED_PAID_LEAVE_SOURCE_LABEL = "Approved paid leave";

type ManualLeaveLineLike = {
  id?: string | null;
  accountCodeId?: number | null;
  code: string;
  description?: string | null;
  hours?: number | null;
  minutes?: number | null;
  amount?: string | number | null;
  sourceTable?: string | null;
  sourceId?: string | null;
  sortOrder?: number | null;
};

type AccountCodeOptionLike = {
  id: number;
  code: string;
  accountType: PayrollExceptionAccountType | null;
  description: string | null;
  month13thPay: boolean;
  nonTaxable: boolean;
};

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function normalizeCode(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function buildManualPayrollLeaveAccountCodeRows(args: {
  lines: ManualLeaveLineLike[];
  accountCodeOptions: AccountCodeOptionLike[];
  idPrefix?: string;
  sourceLabel?: string;
}): PayrollManualLeaveAccountCodeRowView[] {
  const idPrefix = args.idPrefix ?? "manual-leave";
  const sourceLabel = args.sourceLabel ?? MANUAL_PAYROLL_LEAVE_SOURCE_LABEL;
  const accountCodeById = new Map(
    args.accountCodeOptions.map((option) => [option.id, option] as const)
  );
  const accountCodeByCode = new Map(
    args.accountCodeOptions.map(
      (option) => [normalizeCode(option.code), option] as const
    )
  );

  return args.lines.flatMap((line, index) => {
    if (line.sourceTable?.trim() !== MANUAL_PAYROLL_LEAVE_SOURCE_TABLE) {
      return [];
    }

    const account =
      (line.accountCodeId != null ? accountCodeById.get(line.accountCodeId) : null) ??
      accountCodeByCode.get(normalizeCode(line.code)) ??
      null;

    if (!account || account.accountType !== "Paid Leaves") {
      return [];
    }

    const code = account.code || line.code.trim();
    const description = line.description?.trim() || account.description || null;
    const amount = toAmount(line.amount);

    return [
      {
        id: `${idPrefix}:${line.id ?? line.sourceId ?? line.sortOrder ?? index}`,
        manualPayrollLineId: line.id ?? null,
        accountCodeId: account.id,
        accountCodeSnapshot: code,
        accountTypeSnapshot: account.accountType,
        accountDescriptionSnapshot: account.description,
        accountMonth13thPaySnapshot: account.month13thPay,
        accountNonTaxableSnapshot: account.nonTaxable,
        hours: Math.max(0, Math.floor(line.hours ?? 0)),
        minutes: Math.max(0, Math.floor(line.minutes ?? 0)),
        amount: amount.toFixed(2),
        description,
        sourceLabel,
        sourceRemark: description
          ? `${sourceLabel}: ${description}`
          : sourceLabel,
      },
    ];
  });
}

export function buildApprovedPaidLeaveAccountCodeRows(args: {
  lines: ManualLeaveLineLike[];
  accountCodeOptions: AccountCodeOptionLike[];
}): PayrollManualLeaveAccountCodeRowView[] {
  return buildManualPayrollLeaveAccountCodeRows({
    ...args,
    idPrefix: "approved-leave",
    sourceLabel: APPROVED_PAID_LEAVE_SOURCE_LABEL,
  });
}
