import { getNextSemiMonthlyCode, getPeriodByCode, type HolidayLike } from "./calendar";

export const MAX_LOAN_INSTALLMENT_COUNT = 240;
export const SUPPORTED_LOAN_PAYMENT_TERMS = ["Always"] as const;

export type SupportedLoanPaymentTerms =
  (typeof SUPPORTED_LOAN_PAYMENT_TERMS)[number];

export type LoanPaymentTerms =
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

export function calculateLoanBalanceAfterPayments({
  payableAmount,
  totalPaid,
}: {
  payableAmount: number;
  totalPaid: number;
}) {
  const normalizedPayableAmount = Number.isFinite(payableAmount)
    ? Math.max(0, payableAmount)
    : 0;
  const normalizedTotalPaid = Number.isFinite(totalPaid)
    ? Math.max(0, totalPaid)
    : 0;

  return roundMoney(Math.max(0, normalizedPayableAmount - normalizedTotalPaid));
}

export function applyLoanPaymentToBalance({
  currentBalance,
  amountPaid,
}: {
  currentBalance: number;
  amountPaid: number;
}) {
  return calculateLoanBalanceAfterPayments({
    payableAmount: currentBalance,
    totalPaid: amountPaid,
  });
}

export function hasLoanBalanceMismatch({
  storedBalance,
  payableAmount,
  totalPaid,
  tolerance = 0.01,
}: {
  storedBalance: number;
  payableAmount: number;
  totalPaid: number;
  tolerance?: number;
}) {
  const expectedBalance = calculateLoanBalanceAfterPayments({
    payableAmount,
    totalPaid,
  });

  return Math.abs(roundMoney(storedBalance) - expectedBalance) > tolerance;
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
  const normalizedAmortization = roundMoney(
    Number.isFinite(amortization) ? Math.max(0, amortization) : 0
  );
  let installmentNo = 0;
  let guard = 0;

  if (remainingBalance <= 0 || normalizedAmortization <= 0) {
    return installments;
  }

  while (remainingBalance > 0 && currentCode && guard < MAX_LOAN_INSTALLMENT_COUNT) {
    guard += 1;

    if (isCycleApplicable(currentCode, paymentTerms)) {
      const period = getPeriodByCode(currentCode, holidays);
      if (!period) break;

      const scheduledAmount = roundMoney(
        Math.min(remainingBalance, normalizedAmortization)
      );
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

export function getLoanInstallmentPlanRemainingBalance(
  installments: LoanInstallmentSeed[],
  payableAmount: number
) {
  if (installments.length === 0) {
    return roundMoney(Math.max(0, payableAmount));
  }

  return roundMoney(Math.max(0, installments[installments.length - 1].balanceAfter));
}

export function assertLoanInstallmentPlanRepays({
  installments,
  payableAmount,
  amortization,
}: {
  installments: LoanInstallmentSeed[];
  payableAmount: number;
  amortization: number;
}) {
  const normalizedPayableAmount = roundMoney(
    Number.isFinite(payableAmount) ? Math.max(0, payableAmount) : 0
  );
  const normalizedAmortization = roundMoney(
    Number.isFinite(amortization) ? Math.max(0, amortization) : 0
  );

  if (normalizedPayableAmount <= 0) return;

  if (normalizedAmortization <= 0 || installments.length === 0) {
    throw new Error(
      "Loan amortization must be greater than zero and produce at least one scheduled deduction."
    );
  }

  const remainingBalance = getLoanInstallmentPlanRemainingBalance(
    installments,
    normalizedPayableAmount
  );

  if (remainingBalance > 0.01) {
    throw new Error(
      `Loan amortization does not fully repay the payable amount within ${MAX_LOAN_INSTALLMENT_COUNT} semi-monthly deductions. Increase amortization or reduce the payable amount.`
    );
  }
}
