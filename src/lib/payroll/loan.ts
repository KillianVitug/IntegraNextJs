import { getNextSemiMonthlyCode, getPeriodByCode, type HolidayLike } from "./calendar";

type LoanPaymentTerms =
  | "Always"
  | "First Payroll"
  | "Second Payroll"
  | "Third Payroll"
  | "Fourth Payroll";

export type LoanInstallmentSeed = {
  payrollCode: string;
  dueDate: string;
  installmentNo: number;
  scheduledAmount: number;
  balanceAfter: number;
};

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

export function calculateSemiMonthlyAmortization({
  balance,
  termMonths,
}: {
  balance: number;
  termMonths: number;
}) {
  const normalizedBalance = Number.isFinite(balance) ? Math.max(0, balance) : 0;
  const normalizedTermMonths = Number.isFinite(termMonths)
    ? Math.max(1, Math.floor(termMonths))
    : 1;
  const cutoffCount = normalizedTermMonths * 2;

  if (normalizedBalance <= 0) return 0;

  return Math.ceil((normalizedBalance / cutoffCount) * 100) / 100;
}

function isCycleApplicable(payrollCode: string, paymentTerms: LoanPaymentTerms) {
  const cycle = payrollCode.endsWith("-A") ? "A" : payrollCode.endsWith("-B") ? "B" : null;

  if (!cycle) return false;
  if (paymentTerms === "Always") return true;
  if (paymentTerms === "First Payroll") return cycle === "A";
  if (paymentTerms === "Second Payroll") return cycle === "B";

  return false;
}

export function generateLoanInstallmentPlan({
  firstPayrollCode,
  paymentTerms,
  payableAmount,
  amortization,
  holidays = [],
}: {
  firstPayrollCode: string;
  paymentTerms: LoanPaymentTerms;
  payableAmount: number;
  amortization: number;
  holidays?: HolidayLike[];
}) {
  const installments: LoanInstallmentSeed[] = [];
  let currentCode: string | null = firstPayrollCode;
  let remainingBalance = roundMoney(payableAmount);
  let installmentNo = 0;
  let guard = 0;

  while (remainingBalance > 0 && currentCode && guard < 240) {
    guard += 1;

    if (isCycleApplicable(currentCode, paymentTerms)) {
      const period = getPeriodByCode(currentCode, holidays);
      if (!period) break;

      const scheduledAmount = roundMoney(Math.min(remainingBalance, amortization));
      remainingBalance = roundMoney(Math.max(0, remainingBalance - scheduledAmount));
      installmentNo += 1;

      installments.push({
        payrollCode: currentCode,
        dueDate: period.adjustedPayDate,
        installmentNo,
        scheduledAmount,
        balanceAfter: remainingBalance,
      });
    }

    currentCode = getNextSemiMonthlyCode(currentCode);
  }

  return installments;
}
