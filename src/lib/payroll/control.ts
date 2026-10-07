import { payrollGroup, earningMonth, runPayrollGroup, type PayrollGroup } from "./payrollGroupModel";
import { monthlyPayouts } from "./payrollGroups";
import { loadPaymentEmployees } from "./paymentReview";
import { bankListCsv, payrollCents, selectPaymentRows, type PaymentMode } from "./paymentModel";
import { db } from "@/db";
import {
  employeePayrollReadinessChecks,
  employees,
  payrollArtifacts,
  payrollBankFiles,
  payrollDisbursementBatches,
  payrollJournalBatches,
  payrollJournalLines,
  payrollPeriods,
  payrollRunEmployees,
  payrollRunLines,
  payrollRuns,
  payslipPublications,
  statutoryFilingPackages,
  type payrollArtifactKindEnum,
} from "@/db/schema";
import { recordPayrollRunEvent } from "@/lib/admin";
import { isPayrollEligibleEmploymentStatus } from "@/lib/employmentStatus";
import { getActiveStatutoryRuleBundle } from "@/lib/payroll/statutory";
import { and, eq, inArray, sql } from "drizzle-orm";

type PayrollArtifactKind = (typeof payrollArtifactKindEnum.enumValues)[number];

export type EmployeePayrollReadiness = {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  blockers: string[];
  warnings: string[];
};

export type PayrollPreflightResult = {
  payrollPeriodId: string;
  periodCode: string;
  canCompute: boolean;
  statutoryBlockers: string[];
  employeeReadiness: EmployeePayrollReadiness[];
};

export type PayrollPreflightOptions = {
  payrollGroup?: PayrollGroup;
  persist?: boolean;
  bypassTemporaryReadinessCategories?: boolean;
};

const TEMPORARY_BYPASSED_READINESS_CATEGORIES = new Set([
  "Missing BIR tax status.",
  "Missing Pag-IBIG number.",
  "Missing PhilHealth number.",
  "Missing SSS number.",
  "Missing TIN.",
  "Missing employee tax profile; legacy general info tax status will be used.",
  "Missing timekeeping ID.",
]);

function filterTemporaryBypassedReadinessMessages(
  messages: string[],
  options: PayrollPreflightOptions
) {
  if (!options.bypassTemporaryReadinessCategories) return messages;

  return messages.filter(
    (message) => !TEMPORARY_BYPASSED_READINESS_CATEGORIES.has(message)
  );
}

function toAmount(value: string | number | null | undefined) {
  if (value == null) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function money(value: number) {
  return value.toFixed(2);
}

function employeeName(employee: Pick<typeof employees.$inferSelect, "firstName" | "middleName" | "lastName">) {
  return [employee.lastName, employee.firstName, employee.middleName]
    .filter(Boolean)
    .join(", ");
}

async function assertRunCanProduceArtifacts(payrollRunId: string) {
  const run = await db.query.payrollRuns.findFirst({
    where: eq(payrollRuns.id, payrollRunId),
    with: {
      payrollPeriod: true,
      employees: {
        with: {
          lines: true,
        },
      },
    },
  });

  if (!run) {
    throw new Error("Payroll run not found.");
  }

  if (!["Approved", "Posted"].includes(run.status)) {
    throw new Error("Payroll outputs can only be generated from Approved or Posted runs.");
  }

  return run;
}

export async function assertRequiredStatutoryRulesPublished(args: {
  asOfDate: string;
  payrollTerms?: "Semi-Monthly";
}) {
  const bundle = await getActiveStatutoryRuleBundle(
    args.asOfDate,
    args.payrollTerms ?? "Semi-Monthly"
  );
  const missing = [
    ["SSS", bundle.sssVersionId],
    ["PHILHEALTH", bundle.philhealthVersionId],
    ["PAGIBIG", bundle.pagibigVersionId],
    ["TAX", bundle.taxVersionId],
  ]
    .filter(([, versionId]) => versionId == null)
    .map(([ruleType]) => `${ruleType} published statutory rule`);

  if (missing.length > 0) {
    throw new Error(
      `Payroll cannot continue because required statutory rules are missing: ${missing.join(", ")}.`
    );
  }

  return bundle;
}

export async function preflightPayroll(
  payrollPeriodId: string,
  options: PayrollPreflightOptions = {}
): Promise<PayrollPreflightResult> {
  const period = await db.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, payrollPeriodId),
  });

  if (!period) {
    throw new Error("Payroll period not found.");
  }

  if (period.payrollTerms !== "Semi-Monthly") {
    throw new Error("Only semi-monthly payroll periods are supported in v1.");
  }

  const statutoryBundle = await getActiveStatutoryRuleBundle(
    period.adjustedPayDate,
    "Semi-Monthly"
  );
  const statutoryBlockers = [
    ["SSS", statutoryBundle.sssVersionId],
    ["PhilHealth", statutoryBundle.philhealthVersionId],
    ["Pag-IBIG", statutoryBundle.pagibigVersionId],
    ["BIR withholding tax", statutoryBundle.taxVersionId],
  ]
    .filter(([, versionId]) => versionId == null)
    .map(([label]) => `${label} published rule is missing for ${period.adjustedPayDate}.`);

  const employeesForPayroll = await db.query.employees.findMany({
    where: sql`${employees.employeeType} = 'EMP' and ${employees.deletedAt} is null`,
    with: {
      generalInfo: true,
      salary: true,
      otherReferences: true,
      timekeeping: true,
      taxProfile: true,
      openingYearToDateBalances: true,
    },
  });

  const selectedGroup=options.payrollGroup??"Daily",payouts=await monthlyPayouts(earningMonth(period));
  const readiness = employeesForPayroll
    .filter(employee=>payrollGroup(employee.salary)===selectedGroup&&(selectedGroup!=="Monthly"||(payouts.get(employee.id)??"B")===period.cycle))
    .filter((employee) =>
      isPayrollEligibleEmploymentStatus(employee.generalInfo?.employmentStatus)
    )
    .map((employee) => {
      const blockers: string[] = [];
      const warnings: string[] = [];
      const generalInfo = employee.generalInfo;
      const salary = employee.salary;
      const references = employee.otherReferences;
      const taxProfile = employee.taxProfile;
      const hasSalaryRate =
        toAmount(salary?.monthlyRate) > 0 || toAmount(salary?.dailyRate) > 0;

      if (!generalInfo?.dateHired) blockers.push("Missing hire date.");
      if (generalInfo?.payrollTerms !== "Semi-Monthly" && !(selectedGroup==="Monthly"&&generalInfo?.payrollTerms==="Monthly")) {
        blockers.push("Payroll terms must be Semi-Monthly for v1.");
      }
      if (!hasSalaryRate) blockers.push("Missing monthly or daily salary rate.");
      if (!generalInfo?.taxIdNumber) blockers.push("Missing TIN.");
      if (!generalInfo?.sssNumber) blockers.push("Missing SSS number.");
      if (!generalInfo?.philhealthNumber) blockers.push("Missing PhilHealth number.");
      if (!generalInfo?.pagIbigNumber) blockers.push("Missing Pag-IBIG number.");
      if (!generalInfo?.taxStatus && !taxProfile?.taxStatus) {
        blockers.push("Missing BIR tax status.");
      }
      if (generalInfo?.payrollMode === "Bank" && !references?.bankAccountNo) {
        blockers.push("Bank-paid employee is missing bank account number.");
      }
      if (!employee.timekeeping?.timekeepingId) {
        warnings.push("Missing timekeeping ID.");
      }
      if (!taxProfile) {
        warnings.push("Missing employee tax profile; legacy general info tax status will be used.");
      }

      return {
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        employeeName: employeeName(employee),
        blockers: filterTemporaryBypassedReadinessMessages(blockers, options),
        warnings: filterTemporaryBypassedReadinessMessages(warnings, options),
      } satisfies EmployeePayrollReadiness;
    });

  if (options.persist ?? false) {
    await db.transaction(async (tx) => {
      await tx
        .delete(employeePayrollReadinessChecks)
        .where(eq(employeePayrollReadinessChecks.payrollPeriodId, payrollPeriodId));

      const rows = readiness.flatMap((row) => [
        ...row.blockers.map((message, index) => ({
          payrollPeriodId,
          employeeId: row.employeeId,
          checkKey: `blocker_${index}_${message.slice(0, 40)}`,
          severity: "Blocker" as const,
          message,
        })),
        ...row.warnings.map((message, index) => ({
          payrollPeriodId,
          employeeId: row.employeeId,
          checkKey: `warning_${index}_${message.slice(0, 40)}`,
          severity: "Warning" as const,
          message,
        })),
      ]);

      if (rows.length > 0) {
        await tx.insert(employeePayrollReadinessChecks).values(rows);
      }
    });
  }

  return {
    payrollPeriodId,
    periodCode: period.code,
    canCompute:
      statutoryBlockers.length === 0 &&
      readiness.every((employee) => employee.blockers.length === 0),
    statutoryBlockers,
    employeeReadiness: readiness,
  };
}

export async function transitionPayrollRun(args: {
  payrollRunId: string;
  nextStatus: "Reviewed" | "Approved" | "Posted" | "Void";
  actorUserId: string;
  actorRole?: string | null;
  acknowledgeShortfalls?: boolean;
  transition: (
    payrollRunId: string,
    nextStatus: "Reviewed" | "Approved" | "Posted" | "Void",
    actorUserId: string,
    notes?: string | null,
    authorization?: { actorRole?: string | null; acknowledgeShortfalls?: boolean }
  ) => Promise<unknown>;
  notes?: string | null;
}) {
  return args.transition(
    args.payrollRunId,
    args.nextStatus,
    args.actorUserId,
    args.notes ?? null,
    { actorRole: args.actorRole, acknowledgeShortfalls: args.acknowledgeShortfalls }
  );
}

export async function reversePayrollRun(args: {
  payrollRunId: string;
  actorUserId: string;
  reason: string;
}) {
  const original = await db.query.payrollRuns.findFirst({
    where: eq(payrollRuns.id, args.payrollRunId),
    with: {
      employees: {
        with: {
          lines: true,
        },
      },
    },
  });

  if (!original) throw new Error("Payroll run not found.");
  if (original.status !== "Posted") {
    throw new Error("Only posted payroll runs can be reversed.");
  }
  if (original.reversalRunId) {
    throw new Error("Payroll run already has a reversal run.");
  }

  return db.transaction(async (tx) => {
    const [latestRunForPeriod] = await tx
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.payrollPeriodId, original.payrollPeriodId))
      .orderBy(sql`${payrollRuns.runNumber} desc`)
      .limit(1);
    const [reversal] = await tx
      .insert(payrollRuns)
      .values({
        payrollPeriodId: original.payrollPeriodId,
        runType: "Reversal",
        status: "Draft",
        runNumber: (latestRunForPeriod?.runNumber ?? original.runNumber) + 1,
        computedAt: new Date(),
        computedByUserId: args.actorUserId,
        notes: args.reason,
        inputSnapshot: {
          reversedPayrollRunId: original.id,
          reversedRunNumber: original.runNumber,
        },
      })
      .returning();

    const insertedEmployees =
      original.employees.length === 0
        ? []
        : await tx
            .insert(payrollRunEmployees)
            .values(
              original.employees.map((employee) => ({
                payrollRunId: reversal.id,
                employeeId: employee.employeeId,
                employeeNoSnapshot: employee.employeeNoSnapshot,
                employeeNameSnapshot: employee.employeeNameSnapshot,
                salaryAdjustmentId: employee.salaryAdjustmentId,
                salaryAdjustmentMode: employee.salaryAdjustmentMode,
                regularPay: money(-toAmount(employee.regularPay)),
                grossPay: money(-toAmount(employee.grossPay)),
                taxablePay: money(-toAmount(employee.taxablePay)),
                nonTaxablePay: money(-toAmount(employee.nonTaxablePay)),
                totalDeductions: money(-toAmount(employee.totalDeductions)),
                employeeContributions: money(-toAmount(employee.employeeContributions)),
                employerContributions: money(-toAmount(employee.employerContributions)),
                netPay: money(-toAmount(employee.netPay)),
                breakdownNotes: `Reversal of payroll run ${original.id}. ${args.reason}`,
              }))
            )
            .returning({
              id: payrollRunEmployees.id,
              employeeId: payrollRunEmployees.employeeId,
            });

    const employeeRunIdByEmployeeId = new Map(
      insertedEmployees.map((employee) => [employee.employeeId, employee.id])
    );
    const lineRows = original.employees.flatMap((employee) => {
      const payrollRunEmployeeId = employeeRunIdByEmployeeId.get(employee.employeeId);
      if (!payrollRunEmployeeId) return [];

      return employee.lines.map((line) => ({
        payrollRunEmployeeId,
        lineType: line.lineType,
        code: line.code,
        description: `Reversal - ${line.description}`,
        amount: money(-toAmount(line.amount)),
        quantity: line.quantity,
        rate: line.rate,
        taxable: line.taxable,
        month13thEligible: line.month13thEligible,
        birTaxCategory: line.birTaxCategory,
        birDeMinimisType: line.birDeMinimisType,
        sourceTable: line.sourceTable,
        sourceId: line.sourceId,
      }));
    });

    if (lineRows.length > 0) {
      await tx.insert(payrollRunLines).values(lineRows);
    }

    await tx
      .update(payrollRuns)
      .set({ reversalRunId: reversal.id, updatedAt: new Date() })
      .where(eq(payrollRuns.id, original.id));

    await recordPayrollRunEvent({
      payrollRunId: original.id,
      actorUserId: args.actorUserId,
      eventType: "Reversed",
      fromStatus: "Posted",
      toStatus: "Posted",
      notes: args.reason,
      database: tx,
    });

    await recordPayrollRunEvent({
      payrollRunId: reversal.id,
      actorUserId: args.actorUserId,
      eventType: "Computed",
      fromStatus: null,
      toStatus: "Draft",
      notes: `Reversal of payroll run ${original.id}`,
      database: tx,
    });

    return tx.query.payrollRuns.findFirst({
      where: eq(payrollRuns.id, reversal.id),
      with: {
        payrollPeriod: true,
        employees: {
          with: {
            lines: true,
          },
        },
      },
    });
  });
}

export async function publishPayslips(args: { payrollRunId: string; actorUserId: string }, database: typeof db = db) {
  return database.transaction(async tx => {
    await tx.execute(sql`select id from payroll_runs where id=${args.payrollRunId} for update`);
    const run = await tx.query.payrollRuns.findFirst({where: eq(payrollRuns.id, args.payrollRunId), with: {payrollPeriod: true, employees: true}});
    if (!run || !["Approved", "Posted"].includes(run.status)) throw new Error("Approve this run before publishing payslips.");
    const existing = await tx.query.payrollArtifacts.findMany({where: and(eq(payrollArtifacts.payrollRunId, run.id), eq(payrollArtifacts.kind, "Payslip"))});
    const byEmployee = new Map(existing.filter(a => a.payrollRunEmployeeId).map(a => [a.payrollRunEmployeeId, a]));
    const now = new Date();
    const missing = run.employees.filter(employee => !byEmployee.has(employee.id));
    if (missing.length) {
      const added = await tx.insert(payrollArtifacts).values(missing.map(employee => ({
        payrollRunId: run.id, payrollRunEmployeeId: employee.id, kind: "Payslip" as const, status: "Published" as const, format: "PDF" as const,
        fileName: `${employee.employeeNoSnapshot}-${run.payrollPeriod?.code ?? "payroll"}-${runPayrollGroup(run.inputSnapshot)}-payslip.pdf`,
        metadata: {employeeId: employee.employeeId, runNumber: run.runNumber, generatedFrom: "payroll-run-snapshot", payrollGroup: runPayrollGroup(run.inputSnapshot)},
        generatedByUserId: args.actorUserId, generatedAt: now, publishedByUserId: args.actorUserId, publishedAt: now,
      }))).returning();
      for (const artifact of added) byEmployee.set(artifact.payrollRunEmployeeId, artifact);
    }
    const publications = run.employees.length ? await tx.query.payslipPublications.findMany({where: inArray(payslipPublications.payrollRunEmployeeId, run.employees.map(employee => employee.id))}) : [];
    const changed = run.employees.filter(employee => !publications.some(publication => publication.payrollRunEmployeeId === employee.id && publication.status === "Published" && publication.artifactId === byEmployee.get(employee.id)?.id));
    if (changed.length) {
      await tx.insert(payslipPublications).values(changed.map(employee => ({
        payrollRunEmployeeId: employee.id, artifactId: byEmployee.get(employee.id)!.id, status: "Published" as const, publishedByUserId: args.actorUserId, publishedAt: now,
      }))).onConflictDoUpdate({target: payslipPublications.payrollRunEmployeeId, set: {
        artifactId: sql`excluded.artifact_id`, status: "Published", publishedByUserId: args.actorUserId, publishedAt: now,
        revokedByUserId: null, revokedAt: null, revokeReason: null, updatedAt: now,
      }});
      await recordPayrollRunEvent({payrollRunId: run.id, actorUserId: args.actorUserId, eventType: "PayslipsPublished", fromStatus: run.status, toStatus: run.status, notes: `Published ${changed.length} payslip(s).`, database: tx});
    }
    return {publishedCount: run.employees.length};
  });
}

export async function generateBankBatch(args: {
  payrollRunId: string;
  actorUserId: string;
  batchType?: "Bank" | "Cash";
  bankAdapter?: string;
  unassignedMode?: PaymentMode;
}, database: typeof db = db) {
  const batchType = args.batchType ?? "Bank";

  return database.transaction(async (tx) => {
    await tx.execute(sql`select id from payroll_runs where id=${args.payrollRunId} for update`);
    const run = await tx.query.payrollRuns.findFirst({where: eq(payrollRuns.id, args.payrollRunId), with: {payrollPeriod: true}});
    if (!run || !["Approved", "Posted"].includes(run.status)) throw new Error("Approve this run before preparing a payment list.");
    const rows = selectPaymentRows(await loadPaymentEmployees(run.id, tx), batchType, args.unassignedMode);
    if (!rows.length) throw new Error(`No positive ${batchType.toLowerCase()} payments in this run.`);
    const totalNetPay = rows.reduce((total, row) => total + payrollCents(row.netPay), 0) / 100;
    const csv = bankListCsv(rows, batchType);
    // Retries return the same immutable list instead of creating duplicate batches.
    const prior = await tx.query.payrollArtifacts.findMany({where: and(eq(payrollArtifacts.payrollRunId, run.id), eq(payrollArtifacts.kind, batchType === "Bank" ? "BankFile" : "CashPayrollList"))});
    const matching = prior.find(artifact => artifact.metadata?.paymentListCsv === csv);
    if (matching) {
      const previousBatch = await tx.query.payrollDisbursementBatches.findFirst({where: eq(payrollDisbursementBatches.artifactId, matching.id)});
      if (previousBatch) return previousBatch;
    }
    const [artifact] = await tx
      .insert(payrollArtifacts)
      .values({
        payrollRunId: run.id,
        kind: batchType === "Bank" ? "BankFile" : "CashPayrollList",
        status: "Generated",
        format: "CSV",
        fileName: `${run.payrollPeriod?.code ?? "payroll"}-${runPayrollGroup(run.inputSnapshot)}-${batchType.toLowerCase()}-disbursement.csv`,
        metadata: {
          employeeCount: rows.length,
          totalNetPay: money(totalNetPay),
          bankAdapter: null,
          paymentListCsv: csv,
          unassignedMode: args.unassignedMode ?? null,
          purpose: "Payment review list; not a bank-specific upload file or proof of payment.",
        },
        generatedByUserId: args.actorUserId,
        generatedAt: new Date(),
      })
      .returning();

    const [batch] = await tx
      .insert(payrollDisbursementBatches)
      .values({
        payrollRunId: run.id,
        batchType,
        status: "Generated",
        bankAdapter: null,
        employeeCount: rows.length,
        totalNetPay: money(totalNetPay),
        artifactId: artifact.id,
        createdByUserId: args.actorUserId,
      })
      .returning();

    if (batchType === "Bank") {
      await tx.insert(payrollBankFiles).values({
        disbursementBatchId: batch.id,
        artifactId: artifact.id,
        bankAdapter: "Generic review CSV",
        fileName: artifact.fileName ?? "payroll-bank-file.csv",
        employeeCount: rows.length,
        totalAmount: money(totalNetPay),
        generatedByUserId: args.actorUserId,
      });
    }

    await recordPayrollRunEvent({
      payrollRunId: run.id,
      actorUserId: args.actorUserId,
      eventType: "Exported",
      fromStatus: run.status,
      toStatus: run.status,
      notes: `Generated ${batchType} disbursement batch.`,
      database: tx,
    });

    return batch;
  });
}

export async function generateGlJournal(args: {
  payrollRunId: string;
  actorUserId: string;
}) {
  const run = await assertRunCanProduceArtifacts(args.payrollRunId);
  const grossPay = run.employees.reduce(
    (total, employee) => total + toAmount(employee.grossPay),
    0
  );
  const deductions = run.employees.reduce(
    (total, employee) => total + toAmount(employee.totalDeductions),
    0
  );
  const employerContributions = run.employees.reduce(
    (total, employee) => total + toAmount(employee.employerContributions),
    0
  );
  const netPay = run.employees.reduce(
    (total, employee) => total + toAmount(employee.netPay),
    0
  );
  const totalDebits = grossPay + employerContributions;
  const totalCredits = netPay + deductions + employerContributions;

  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new Error("Payroll journal is not balanced. Review payroll totals before export.");
  }

  return db.transaction(async (tx) => {
    const [artifact] = await tx
      .insert(payrollArtifacts)
      .values({
        payrollRunId: run.id,
        kind: "GlJournal",
        status: "Generated",
        format: "CSV",
        fileName: `${run.payrollPeriod?.code ?? "payroll"}-${runPayrollGroup(run.inputSnapshot)}-gl-journal.csv`,
        metadata: {
          totalDebits: money(totalDebits),
          totalCredits: money(totalCredits),
        },
        generatedByUserId: args.actorUserId,
        generatedAt: new Date(),
      })
      .returning();
    const [journal] = await tx
      .insert(payrollJournalBatches)
      .values({
        payrollRunId: run.id,
        status: "Balanced",
        totalDebits: money(totalDebits),
        totalCredits: money(totalCredits),
        artifactId: artifact.id,
        createdByUserId: args.actorUserId,
      })
      .returning();

    await tx.insert(payrollJournalLines).values([
      {
        journalBatchId: journal.id,
        accountCode: "PAYROLL_EXPENSE",
        accountName: "Payroll Expense",
        debit: money(grossPay),
        credit: "0.00",
        memo: `Payroll gross pay for run ${run.id}`,
        sourceLineType: "Earning",
      },
      {
        journalBatchId: journal.id,
        accountCode: "EMPLOYER_CONTRIBUTION_EXPENSE",
        accountName: "Employer Contribution Expense",
        debit: money(employerContributions),
        credit: "0.00",
        memo: `Employer contributions for run ${run.id}`,
        sourceLineType: "Employer Contribution",
      },
      {
        journalBatchId: journal.id,
        accountCode: "PAYROLL_CLEARING",
        accountName: "Payroll Net Pay Clearing",
        debit: "0.00",
        credit: money(netPay),
        memo: `Net pay payable for run ${run.id}`,
        sourceLineType: "Deduction",
      },
      {
        journalBatchId: journal.id,
        accountCode: "PAYROLL_STATUTORY_AND_DEDUCTION_LIABILITY",
        accountName: "Payroll Statutory and Deduction Liability",
        debit: "0.00",
        credit: money(deductions + employerContributions),
        memo: `Deductions and employer liabilities for run ${run.id}`,
        sourceLineType: "Deduction",
      },
    ]);

    await recordPayrollRunEvent({
      payrollRunId: run.id,
      actorUserId: args.actorUserId,
      eventType: "Exported",
      fromStatus: run.status,
      toStatus: run.status,
      notes: "Generated balanced GL journal.",
      database: tx,
    });

    return journal;
  });
}

export async function generateStatutoryPackage(args: {
  payrollRunId: string;
  actorUserId: string;
  kind: Extract<
    PayrollArtifactKind,
    | "SssContribution"
    | "SssLoan"
    | "PhilhealthEprs"
    | "PagibigMcrf"
    | "Bir1601C"
    | "Bir1604C"
    | "Bir2316"
    | "Dole13thMonth"
  >;
}) {
  const run = await assertRunCanProduceArtifacts(args.payrollRunId);
  if (!run.payrollPeriod) throw new Error("Payroll period not found.");

  const lineCodesByKind: Record<typeof args.kind, string[]> = {
    SssContribution: ["SSS", "SSS-ER", "SSS-EC"],
    SssLoan: [],
    PhilhealthEprs: ["PHILHEALTH", "PHILHEALTH-ER"],
    PagibigMcrf: ["PAGIBIG", "PAGIBIG-ER"],
    Bir1601C: ["TAX"],
    Bir1604C: ["TAX"],
    Bir2316: ["TAX"],
    Dole13thMonth: [],
  };
  const amountDue = run.employees.reduce(
    (total, employee) =>
      total +
      employee.lines
        .filter((line) => lineCodesByKind[args.kind].includes(line.code))
        .reduce((lineTotal, line) => lineTotal + toAmount(line.amount), 0),
    0
  );

  return db.transaction(async (tx) => {
    const [artifact] = await tx
      .insert(payrollArtifacts)
      .values({
        payrollRunId: run.id,
        kind: args.kind,
        status: "Generated",
        format: "CSV",
        fileName: `${run.payrollPeriod?.code ?? "payroll"}-${runPayrollGroup(run.inputSnapshot)}-${args.kind}.csv`,
        metadata: {
          amountDue: money(amountDue),
          periodStart: run.payrollPeriod?.startDate,
          periodEnd: run.payrollPeriod?.endDate,
        },
        generatedByUserId: args.actorUserId,
        generatedAt: new Date(),
      })
      .returning();

    const [filingPackage] = await tx
      .insert(statutoryFilingPackages)
      .values({
        payrollRunId: run.id,
        kind: args.kind,
        status: "Generated",
        periodStart: run.payrollPeriod.startDate,
        periodEnd: run.payrollPeriod.endDate,
        amountDue: money(amountDue),
        artifactId: artifact.id,
        preparedByUserId: args.actorUserId,
      })
      .returning();

    await recordPayrollRunEvent({
      payrollRunId: run.id,
      actorUserId: args.actorUserId,
      eventType: "Exported",
      fromStatus: run.status,
      toStatus: run.status,
      notes: `Generated ${args.kind} statutory package.`,
      database: tx,
    });

    return filingPackage;
  });
}

export async function getPublishedEmployeePayslips(employeeId: string) {
  const rows = await db
    .select({
      publication: payslipPublications,
      runEmployee: payrollRunEmployees,
      run: payrollRuns,
      period: payrollPeriods,
      artifact: payrollArtifacts,
    })
    .from(payslipPublications)
    .innerJoin(
      payrollRunEmployees,
      eq(payslipPublications.payrollRunEmployeeId, payrollRunEmployees.id)
    )
    .innerJoin(payrollRuns, eq(payrollRunEmployees.payrollRunId, payrollRuns.id))
    .innerJoin(payrollPeriods, eq(payrollRuns.payrollPeriodId, payrollPeriods.id))
    .leftJoin(payrollArtifacts, eq(payslipPublications.artifactId, payrollArtifacts.id))
    .where(
      and(
        eq(payrollRunEmployees.employeeId, employeeId),
        eq(payslipPublications.status, "Published"),
        inArray(payrollRuns.status, ["Approved", "Posted"])
      )
    );

  const runEmployeeIds = rows.map((row) => row.runEmployee.id);
  const lines =
    runEmployeeIds.length === 0
      ? []
      : await db
          .select()
          .from(payrollRunLines)
          .where(inArray(payrollRunLines.payrollRunEmployeeId, runEmployeeIds));
  const linesByEmployeeRunId = new Map<string, typeof lines>();

  for (const line of lines) {
    const current = linesByEmployeeRunId.get(line.payrollRunEmployeeId) ?? [];
    current.push(line);
    linesByEmployeeRunId.set(line.payrollRunEmployeeId, current);
  }

  return rows.map((row) => ({
    ...row,
    lines: linesByEmployeeRunId.get(row.runEmployee.id) ?? [],
  }));
}
