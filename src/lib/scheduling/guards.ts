import "server-only";
import { and, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { DbClient } from "@/db";
import { employeeShiftAssignments } from "@/db/schema";
import { PayrollValidationError } from "@/lib/payroll/validation";

/** Older editors may not change a confirmed period behind its revision history. */
export async function assertNoConfirmedScheduleEdit(
  tx: DbClient,
  args: { employeeId: string; startDate: string; endDate: string | null },
) {
  const [confirmed] = await tx.select({ day: employeeShiftAssignments.effectiveFrom })
    .from(employeeShiftAssignments)
    .where(and(
      eq(employeeShiftAssignments.employeeId, args.employeeId),
      isNotNull(employeeShiftAssignments.scheduleDecisionId),
      lte(employeeShiftAssignments.effectiveFrom, args.endDate ?? "9999-12-31"),
      or(isNull(employeeShiftAssignments.effectiveTo), gte(employeeShiftAssignments.effectiveTo, args.startDate)),
    )).limit(1);
  if (confirmed) throw new PayrollValidationError(
    `This range includes a confirmed schedule (${confirmed.day}). Open Schedules to review a new period revision; nothing was changed.`,
  );
}
