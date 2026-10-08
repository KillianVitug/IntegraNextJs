import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { workPlans, workHistory } from "@/db/attendanceWorkbenchSchema";
import { payrollPeriods, payrollRuns } from "@/db/schema";
import { assertAttendanceSourceReady, attendancePayrollSnapshot } from "./attendanceSourceGuard";
import { PayrollValidationError } from "./validation";

export type AttendanceCompletion = {
  decision: "approved";
  attendance: "pending" | "updated" | "adjustment-required";
  payroll: "unchanged";
  message: string;
  affectedPeriodIds: string[];
  pendingPeriodIds: string[];
  adjustmentPeriodIds: string[];
};

/** Read the persisted decision and current input receipt, never infer success from a response timeout. */
export async function attendanceBatchCompletion(periodId: string, batchId: string, planIds: string[], database: DbClient = db): Promise<AttendanceCompletion> {
  const plans = await database.select().from(workPlans).where(and(eq(workPlans.periodId, periodId), eq(workPlans.batchId, batchId)));
  if (!planIds.length || planIds.some(id => !plans.some(p => p.id === id && ["Approved", "Applying", "Sync pending", "Resolved", "Source conflict"].includes(p.state)))) {
    throw new PayrollValidationError("No approved decision was found for this batch. Your draft is retained; review its saved status before confirming.");
  }
  if(plans.filter(p=>planIds.includes(p.id)).some(p=>p.sourceRequest&&(p.sourceResult as {readOnlyCutover?:{localApproved?:boolean}}|null)?.readOnlyCutover?.localApproved!==true)){
    throw new PayrollValidationError("This historical source request needs local attendance review. No new source update will be sent.");
  }
  const affectedPeriodIds = [...new Set([periodId, ...plans.filter(p=>planIds.includes(p.id)).flatMap(p=>Array.isArray(p.impactedPeriodIds)?p.impactedPeriodIds.filter((id):id is string=>typeof id==="string"):[])])];
  const periods = await database.select().from(payrollPeriods).where(inArray(payrollPeriods.id,affectedPeriodIds));
  if(periods.length!==affectedPeriodIds.length)throw new PayrollValidationError("An affected payroll period is unavailable. The decision is saved; inspect its history before retrying.");
  const posted = await database.select().from(payrollRuns).where(and(inArray(payrollRuns.payrollPeriodId,affectedPeriodIds),eq(payrollRuns.status,"Posted")));
  const adjustmentPeriodIds = periods.filter(p=>p.status!=="Open"||posted.some(r=>r.payrollPeriodId===p.id&&r.inputSnapshot?.payrollGroup!=="Monthly")).map(p=>p.id);
  const pendingPeriodIds:string[]=[];
  for(const affected of affectedPeriodIds.filter(id=>!adjustmentPeriodIds.includes(id))){
    try { await assertAttendanceSourceReady(affected, database); }
    catch (error) {
      if (!(error instanceof PayrollValidationError)) throw error;
      const version=await attendancePayrollSnapshot(database,affected);
      const [receipt]=await database.select({id:workHistory.id}).from(workHistory).where(and(eq(workHistory.action,"Attendance decision DTR refreshed"),sql`${workHistory.details}->>'periodId'=${affected}`,sql`${workHistory.details}->>'version'=${version}`,sql`${workHistory.details}->'planIds' @> ${JSON.stringify(planIds)}::jsonb`)).limit(1);
      if(!receipt)pendingPeriodIds.push(affected);
    }
  }
  const attendance=pendingPeriodIds.length?"pending":adjustmentPeriodIds.length?"adjustment-required":"updated";
  const message=pendingPeriodIds.length?"Decision saved. Selected attendance update pending. Payroll has not been recalculated.":adjustmentPeriodIds.length?"Decision saved for adjustment review. Posted payroll and its attendance remain unchanged.":"Decision saved. Selected attendance updated. Payroll preparation remains separate.";
  return { decision:"approved",attendance,payroll:"unchanged",message,affectedPeriodIds,pendingPeriodIds,adjustmentPeriodIds };
}
