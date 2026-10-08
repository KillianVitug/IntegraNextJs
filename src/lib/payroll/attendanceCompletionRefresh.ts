import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { payrollPeriods, payrollRuns } from "@/db/schema";
import { workHistory, workPlans, workTreatments } from "@/db/attendanceWorkbenchSchema";
import { rebuildEmployeeAttendanceSummaries } from "@/app/actions/shiftAssignmentHelpers";
import { attendancePayrollSnapshot, lockAttendancePayrollInput } from "./attendanceSourceGuard";
import { adminDecision } from "./attendanceAdminDecision";
import type { WorkDraft } from "./attendanceWorkbenchModel";
import { sourceDayOffset } from "./attendanceSourceClient";
import { PayrollValidationError } from "./validation";

export const ATTENDANCE_DECISION_DTR_REFRESHED = "Attendance decision DTR refreshed";
const inputSchema = z.object({ actor: z.string().min(1), periodId: z.string().uuid(), batchId: z.string().uuid(), planIds: z.array(z.string().uuid()).min(1).max(20) });
export type AttendanceDecisionDtrRefresh = {
  refreshed: boolean; adjustmentRequired: boolean; periodId: string; version: string | null; planIds: string[];
  affectedTargets: Array<{employeeId:string;day:string}>; summariesRebuilt: number;
};

/** Deliberate local summary update only. It never refreshes manual payroll money
 * lines, generated earnings, holds, payroll runs or whole-period readiness.
 */
export async function refreshAttendanceDecisionDtr(raw: z.input<typeof inputSchema>, database: typeof db = db): Promise<AttendanceDecisionDtrRefresh> {
  const input = inputSchema.parse(raw), planIds = [...new Set(input.planIds)].sort();
  return database.transaction(async tx => {
    await lockAttendancePayrollInput(tx);
    const [period] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, input.periodId));
    if (!period) throw new PayrollValidationError("The affected payroll period is unavailable. The attendance decision remains saved.");
    const plans = await tx.select().from(workPlans).where(and(eq(workPlans.batchId, input.batchId), inArray(workPlans.id, planIds)));
    if (plans.length !== planIds.length || plans.some(plan => !["Approved", "Applying", "Sync pending", "Resolved", "Source conflict"].includes(plan.state))) {
      throw new PayrollValidationError("The selected approved plans do not match this batch and affected period. Check saved progress before retrying.");
    }
    const relevantPlans = plans.filter(plan => plan.periodId === period.id || Array.isArray(plan.impactedPeriodIds) && plan.impactedPeriodIds.includes(period.id));
    if (!relevantPlans.length) throw new PayrollValidationError("This period is not affected by the selected attendance decisions.");
    const version = await attendancePayrollSnapshot(tx, period.id);
    const base = { periodId: period.id, version, planIds, affectedTargets: [], summariesRebuilt: 0 };
    const posted = await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.payrollPeriodId, period.id), eq(payrollRuns.status, "Posted"), sql`coalesce(${payrollRuns.inputSnapshot}->>'payrollGroup','Legacy') <> 'Monthly'`)).limit(1);
    if (period.status !== "Open" || posted.length) return { ...base, refreshed: false, adjustmentRequired: true };
    const receipts = await tx.select({ details: workHistory.details }).from(workHistory).where(and(eq(workHistory.action, ATTENDANCE_DECISION_DTR_REFRESHED), sql`${workHistory.details}->>'periodId'=${period.id}`, sql`${workHistory.details}->>'batchId'=${input.batchId}`));
    if (receipts.some(({details}) => { const receipt = details as {version?:string|null;planIds?:string[]}; return receipt.version === version && Array.isArray(receipt.planIds) && planIds.every(id => receipt.planIds!.includes(id)); })) return { ...base, refreshed: false, adjustmentRequired: false };
    const treatments = await tx.select().from(workTreatments).where(and(eq(workTreatments.periodId, period.id), inArray(workTreatments.planId, planIds)));
    const targets = new Map<string, {employeeId:string;day:string}>();
    for (const plan of relevantPlans) {
      const decisions = treatments.filter(row => row.planId === plan.id && adminDecision(row.payload));
      const draft = plan.draft as WorkDraft;
      if (!decisions.length) {
        const containsChange = [...draft.days, ...draft.changes.flatMap(change => change.at ? [change.at.slice(0, 10)] : [])].some(day => day >= period.startDate && day <= period.endDate);
        if (plan.periodId === period.id || containsChange) throw new PayrollValidationError("A local approved attendance decision is unavailable for this period. Inspect saved history before updating DTR; no changes were applied.");
        continue; // Adjacent evidence alone may appear in impacts without any approved input change here.
      }
      for (const day of new Set([...draft.days, ...decisions.map(row => row.day)])) {
        if (day >= period.startDate && day <= period.endDate) targets.set(`${plan.employeeId}|${day}`, { employeeId: plan.employeeId, day });
      }
    }
    const affectedTargets = [...targets.values()].sort((a,b) => a.employeeId.localeCompare(b.employeeId) || a.day.localeCompare(b.day));
    const ranges: Array<{employeeId:string;startDate:string;endDate:string}> = [];
    for (const target of affectedTargets) {
      const previous = ranges.at(-1);
      if (previous?.employeeId === target.employeeId && sourceDayOffset(previous.endDate, 1) === target.day) previous.endDate = target.day;
      else ranges.push({ employeeId: target.employeeId, startDate: target.day, endDate: target.day });
    }
    let summariesRebuilt = 0;
    for (const range of ranges) summariesRebuilt += await rebuildEmployeeAttendanceSummaries({ tx, ...range });
    await tx.insert(workHistory).values({ actor: input.actor, action: ATTENDANCE_DECISION_DTR_REFRESHED, details: { periodId: period.id, version, planIds, batchId: input.batchId, affectedTargets, summariesRebuilt } });
    return { ...base, refreshed: true, adjustmentRequired: false, affectedTargets, summariesRebuilt };
  });
}
