import { db } from "@/db";
import {
  leaveBalanceLedger,
  leaveTypes,
  payrollPeriods,
  payrollRunEmployees,
  payrollRunLines,
  payrollRuns,
} from "@/db/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";

export async function getPayrollRegister(runId: string) {
  return db.query.payrollRuns.findFirst({
    where: eq(payrollRuns.id, runId),
    with: {
      payrollPeriod: true,
      employees: true,
    },
  });
}

export async function getEmployeePayslip(runId: string, employeeId: string) {
  return db.query.payrollRunEmployees.findFirst({
    where: and(
      eq(payrollRunEmployees.payrollRunId, runId),
      eq(payrollRunEmployees.employeeId, employeeId)
    ),
    with: {
      lines: true,
      payrollRun: {
        with: {
          payrollPeriod: true,
        },
      },
    },
  });
}

export async function getAgencyDeductionSummary(runId: string) {
  const [summary] = await db
    .select({
      sssEmployee: sql<string>`COALESCE(SUM(CASE WHEN ${payrollRunLines.code} = 'SSS' THEN ${payrollRunLines.amount} ELSE 0 END), 0)`,
      philhealthEmployee: sql<string>`COALESCE(SUM(CASE WHEN ${payrollRunLines.code} = 'PHILHEALTH' THEN ${payrollRunLines.amount} ELSE 0 END), 0)`,
      pagibigEmployee: sql<string>`COALESCE(SUM(CASE WHEN ${payrollRunLines.code} = 'PAGIBIG' THEN ${payrollRunLines.amount} ELSE 0 END), 0)`,
      withholdingTax: sql<string>`COALESCE(SUM(CASE WHEN ${payrollRunLines.code} = 'TAX' THEN ${payrollRunLines.amount} ELSE 0 END), 0)`,
      sssEmployer: sql<string>`COALESCE(SUM(CASE WHEN ${payrollRunLines.code} = 'SSS-ER' THEN ${payrollRunLines.amount} ELSE 0 END), 0)`,
      philhealthEmployer: sql<string>`COALESCE(SUM(CASE WHEN ${payrollRunLines.code} = 'PHILHEALTH-ER' THEN ${payrollRunLines.amount} ELSE 0 END), 0)`,
      pagibigEmployer: sql<string>`COALESCE(SUM(CASE WHEN ${payrollRunLines.code} = 'PAGIBIG-ER' THEN ${payrollRunLines.amount} ELSE 0 END), 0)`,
      sssEc: sql<string>`COALESCE(SUM(CASE WHEN ${payrollRunLines.code} = 'SSS-EC' THEN ${payrollRunLines.amount} ELSE 0 END), 0)`,
    })
    .from(payrollRunLines)
    .innerJoin(
      payrollRunEmployees,
      eq(payrollRunLines.payrollRunEmployeeId, payrollRunEmployees.id)
    )
    .where(eq(payrollRunEmployees.payrollRunId, runId));

  return summary;
}

export async function getLoanDeductionSummary(runId: string) {
  return db
    .select({
      employeeId: payrollRunEmployees.employeeId,
      employeeNo: payrollRunEmployees.employeeNoSnapshot,
      employeeName: payrollRunEmployees.employeeNameSnapshot,
      description: payrollRunLines.description,
      amount: payrollRunLines.amount,
      sourceId: payrollRunLines.sourceId,
    })
    .from(payrollRunLines)
    .innerJoin(
      payrollRunEmployees,
      eq(payrollRunLines.payrollRunEmployeeId, payrollRunEmployees.id)
    )
    .where(
      and(
        eq(payrollRunEmployees.payrollRunId, runId),
        eq(payrollRunLines.sourceTable, "loan_installments")
      )
    );
}

export async function getLeaveUtilizationSummary(params: {
  employeeId?: string;
  fromDate: string;
  toDate: string;
}) {
  const query = db
    .select({
      employeeId: leaveBalanceLedger.employeeId,
      leaveCode: leaveTypes.code,
      leaveName: leaveTypes.name,
      totalQuantity: sql<string>`COALESCE(SUM(${leaveBalanceLedger.quantity}), 0)`,
    })
    .from(leaveBalanceLedger)
    .innerJoin(leaveTypes, eq(leaveBalanceLedger.leaveTypeId, leaveTypes.id))
    .where(
      and(
        gte(leaveBalanceLedger.entryDate, params.fromDate),
        lte(leaveBalanceLedger.entryDate, params.toDate),
        params.employeeId
          ? eq(leaveBalanceLedger.employeeId, params.employeeId)
          : sql`TRUE`
      )
    )
    .groupBy(
      leaveBalanceLedger.employeeId,
      leaveTypes.code,
      leaveTypes.name
    );

  return query;
}

export async function getPayrollRunByPeriodCode(periodCode: string) {
  return db.query.payrollRuns.findMany({
    with: {
      payrollPeriod: true,
      employees: {
        with: {
          lines: true,
        },
      },
    },
    where: sql`${payrollRuns.payrollPeriodId} IN (
      SELECT ${payrollPeriods.id}
      FROM ${payrollPeriods}
      WHERE ${payrollPeriods.code} = ${periodCode}
    )`,
  });
}
