import { eq, inArray, desc } from "drizzle-orm";
import { payrollRunEmployees, payrollRuns } from "@/db/schema";
import { recordPayrollRunEvent } from "@/lib/admin";
import type { DbClient } from "@/db";

type DbLike = DbClient;

const EMPLOYEE_INPUT_STALE_STATUSES = ["Draft", "Reviewed", "Approved"] as const;

type EmployeeInputStaleStatus = (typeof EMPLOYEE_INPUT_STALE_STATUSES)[number];

function isEmployeeInputStaleStatus(
  status: string
): status is EmployeeInputStaleStatus {
  return EMPLOYEE_INPUT_STALE_STATUSES.includes(
    status as EmployeeInputStaleStatus
  );
}

export async function markEmployeePayrollRunsStale(args: {
  tx: DbLike;
  employeeId: string;
  actorUserId: string;
  notes: string;
}) {
  const affectedRuns = await args.tx
    .select({
      id: payrollRuns.id,
      status: payrollRuns.status,
    })
    .from(payrollRuns)
    .innerJoin(
      payrollRunEmployees,
      eq(payrollRunEmployees.payrollRunId, payrollRuns.id)
    )
    .where(eq(payrollRunEmployees.employeeId, args.employeeId))
    .orderBy(desc(payrollRuns.createdAt));

  const runsToMarkStale = affectedRuns.filter((run: { status: string }) =>
    isEmployeeInputStaleStatus(run.status)
  );

  if (runsToMarkStale.length === 0) return 0;

  await args.tx
    .update(payrollRuns)
    .set({
      status: "Stale",
      reviewedAt: null,
      reviewedByUserId: null,
      approvedAt: null,
      approvedByUserId: null,
      updatedAt: new Date(),
    })
    .where(inArray(payrollRuns.id, runsToMarkStale.map((run: { id: string }) => run.id)));

  for (const run of runsToMarkStale) {
    await recordPayrollRunEvent({
      payrollRunId: run.id,
      actorUserId: args.actorUserId,
      eventType: "MarkedStale",
      fromStatus: run.status,
      toStatus: "Stale",
      notes: args.notes,
      database: args.tx,
    });
  }

  return runsToMarkStale.length;
}
