import assert from "node:assert/strict";
import {
  MAX_LOAN_INSTALLMENT_COUNT,
  applyLoanPaymentToBalance,
  assertLoanInstallmentPlanRepays,
  calculateLoanBalanceAfterPayments,
  calculateSemiMonthlyAmortization,
  generateLoanInstallmentPlan,
  getLoanInstallmentPlanRemainingBalance,
  hasLoanBalanceMismatch,
  type LoanInstallmentSeed,
} from "@/lib/payroll/loan";
import { getNextSemiMonthlyCode } from "@/lib/payroll/calendar";

type SimulatedRunStatus = "Draft" | "Reviewed" | "Approved" | "Posted" | "Stale";

function assertThrowsWithMessage(fn: () => void, message: RegExp) {
  assert.throws(fn, (error) => {
    assert(error instanceof Error);
    return message.test(error.message);
  });
}

function makePlan(args: {
  firstPayrollCode?: string;
  payableAmount: number;
  amortization: number;
}) {
  return generateLoanInstallmentPlan({
    firstPayrollCode: args.firstPayrollCode ?? "2026-01-A",
    paymentTerms: "Always",
    payableAmount: args.payableAmount,
    amortization: args.amortization,
  });
}

function simulatePayrollPost(args: {
  startingBalance: number;
  loanLines: Array<{ installmentId: string; amount: number }>;
  existingPaymentInstallmentIds?: string[];
}) {
  let balance = args.startingBalance;
  const paidInstallmentIds = new Set(args.existingPaymentInstallmentIds ?? []);
  const paymentRows: Array<{ installmentId: string; amountPaid: number }> = [];

  for (const line of args.loanLines) {
    if (paidInstallmentIds.has(line.installmentId)) continue;

    balance = applyLoanPaymentToBalance({
      currentBalance: balance,
      amountPaid: line.amount,
    });
    paidInstallmentIds.add(line.installmentId);
    paymentRows.push({
      installmentId: line.installmentId,
      amountPaid: line.amount,
    });
  }

  return {
    balance,
    paymentRows,
    paidInstallmentIds,
  };
}

function simulateSkipAndRegenerate(args: {
  existingInstallments: LoanInstallmentSeed[];
  installmentNoToSkip: number;
  payableAmount: number;
  totalPaid: number;
  amortization: number;
}) {
  const installmentToSkip = args.existingInstallments.find(
    (installment) => installment.installmentNo === args.installmentNoToSkip
  );
  assert(installmentToSkip, "Installment to skip should exist.");

  const currentBalance = calculateLoanBalanceAfterPayments({
    payableAmount: args.payableAmount,
    totalPaid: args.totalPaid,
  });
  const nextPayrollCode = getNextSemiMonthlyCode(installmentToSkip.payrollCode);
  const regenerated = nextPayrollCode
    ? generateLoanInstallmentPlan({
        firstPayrollCode: nextPayrollCode,
        paymentTerms: "Always",
        payableAmount: currentBalance,
        amortization: args.amortization,
      })
    : [];

  assertLoanInstallmentPlanRepays({
    installments: regenerated,
    payableAmount: currentBalance,
    amortization: args.amortization,
  });

  return {
    skippedBalanceAfter: currentBalance,
    regenerated,
  };
}

function simulateMarkAffectedRunsStale(runs: SimulatedRunStatus[]) {
  const blockingRun = runs.find(
    (status) => status === "Approved" || status === "Posted"
  );
  if (blockingRun) {
    throw new Error(
      `Loan changes are blocked because a payroll run is already ${blockingRun}.`
    );
  }

  return runs.map((status) =>
    status === "Draft" || status === "Reviewed" ? "Stale" : status
  );
}

assert.equal(
  calculateSemiMonthlyAmortization({ balance: 1200, termMonths: 12 }),
  50
);
assert.equal(
  calculateSemiMonthlyAmortization({ balance: 1000.01, termMonths: 1 }),
  500.01
);

const fiveCutoffPlan = makePlan({ payableAmount: 1000, amortization: 200 });
assert.equal(fiveCutoffPlan.length, 5);
assert.equal(fiveCutoffPlan.at(-1)?.scheduledAmount, 200);
assert.equal(fiveCutoffPlan.at(-1)?.balanceAfter, 0);
assertLoanInstallmentPlanRepays({
  installments: fiveCutoffPlan,
  payableAmount: 1000,
  amortization: 200,
});

const unevenPlan = makePlan({ payableAmount: 1000, amortization: 333.33 });
assert.equal(unevenPlan.length, 4);
assert.equal(unevenPlan.at(-1)?.scheduledAmount, 0.01);
assert.equal(getLoanInstallmentPlanRemainingBalance(unevenPlan, 1000), 0);

const longPlan = makePlan({
  payableAmount: 12000,
  amortization: calculateSemiMonthlyAmortization({
    balance: 12000,
    termMonths: 120,
  }),
});
assert.equal(longPlan.length, MAX_LOAN_INSTALLMENT_COUNT);
assert.equal(longPlan.at(-1)?.balanceAfter, 0);

const holidayAdjustedPlan = generateLoanInstallmentPlan({
  firstPayrollCode: "2026-01-A",
  paymentTerms: "Always",
  payableAmount: 100,
  amortization: 100,
  holidays: [{ holidayDate: "2026-01-20" }],
});
assert.equal(holidayAdjustedPlan[0]?.dueDate, "2026-01-19");

const underpayingPlan = makePlan({ payableAmount: 12001, amortization: 50 });
assert.equal(underpayingPlan.length, MAX_LOAN_INSTALLMENT_COUNT);
assert.equal(underpayingPlan.at(-1)?.balanceAfter, 1);
assertThrowsWithMessage(
  () =>
    assertLoanInstallmentPlanRepays({
      installments: underpayingPlan,
      payableAmount: 12001,
      amortization: 50,
    }),
  /does not fully repay/
);

assert.equal(
  calculateLoanBalanceAfterPayments({ payableAmount: 1000, totalPaid: 300 }),
  700
);
assert.equal(
  hasLoanBalanceMismatch({
    storedBalance: 700,
    payableAmount: 1000,
    totalPaid: 300,
  }),
  false
);
assert.equal(
  hasLoanBalanceMismatch({
    storedBalance: 701,
    payableAmount: 1000,
    totalPaid: 300,
  }),
  true
);

const postedOnce = simulatePayrollPost({
  startingBalance: 500,
  loanLines: [
    { installmentId: "installment-1", amount: 200 },
    { installmentId: "installment-2", amount: 200 },
  ],
});
assert.equal(postedOnce.balance, 100);
assert.equal(postedOnce.paymentRows.length, 2);

const postedAgain = simulatePayrollPost({
  startingBalance: postedOnce.balance,
  loanLines: [
    { installmentId: "installment-1", amount: 200 },
    { installmentId: "installment-2", amount: 200 },
  ],
  existingPaymentInstallmentIds: [...postedOnce.paidInstallmentIds],
});
assert.equal(postedAgain.balance, 100);
assert.equal(postedAgain.paymentRows.length, 0);

const skipped = simulateSkipAndRegenerate({
  existingInstallments: fiveCutoffPlan,
  installmentNoToSkip: 2,
  payableAmount: 1000,
  totalPaid: 200,
  amortization: 200,
});
assert.equal(skipped.skippedBalanceAfter, 800);
assert.equal(skipped.regenerated.length, 4);
assert.equal(skipped.regenerated.at(-1)?.balanceAfter, 0);

assert.deepEqual(
  simulateMarkAffectedRunsStale(["Draft", "Reviewed", "Stale"]),
  ["Stale", "Stale", "Stale"]
);
assertThrowsWithMessage(
  () => simulateMarkAffectedRunsStale(["Draft", "Approved"]),
  /already Approved/
);
assertThrowsWithMessage(
  () => simulateMarkAffectedRunsStale(["Posted"]),
  /already Posted/
);

console.log("Loan functionality verification passed.");
