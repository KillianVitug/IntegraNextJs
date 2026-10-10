"use server";
import { requireAdminActor } from "@/lib/admin";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { saveWorkDraft, prepareWorkApproval, approveWorkBatch, loadWorkBoard } from "@/lib/payroll/attendanceWorkbench";
import { processWorkDelivery, closeAdjustment, reopenWorkPlan, undoWorkDraft, archiveWorkDraft } from "@/lib/payroll/attendanceWorkbenchDelivery";
import { payrollActionResult } from "@/lib/payroll/validation";
import type { WorkDraft } from "@/lib/payroll/attendanceWorkbenchModel";
import { and, eq } from "drizzle-orm";
import { workTreatments, workHistory, workPlans } from "@/db/attendanceWorkbenchSchema";
import { fetchShiftTables } from "@/lib/queries/fetchLookupData";
import { compareShiftTableSchedules, shiftTableScheduleLabel } from "@/lib/scheduling/presentation";
import { adminDecision } from "@/lib/payroll/attendanceAdminDecision";
import { lockAttendancePayrollInput } from "@/lib/payroll/attendanceSourceGuard";
import { PayrollValidationError } from "@/lib/payroll/validation";
import { attendanceBatchCompletion, type AttendanceCompletion } from "@/lib/payroll/attendanceCompletion";
import { refreshAttendanceDecisionDtr } from "@/lib/payroll/attendanceCompletionRefresh";
export async function saveWorkDraftAction(periodId:string,drafts:WorkDraft[],existing?:{id:string;revision:number}) {const actor=await requireAdminActor();return payrollActionResult(()=>db.transaction(tx=>saveWorkDraft(tx,actor.userId,periodId,drafts.map(d=>({...d,ownerId:d.ownerId||actor.userId})),existing)));}
export async function previewWorkBatchAction(periodId:string,batchId:string,revision:number,planIds?:string[]) {await requireAdminActor();return payrollActionResult(()=>prepareWorkApproval(periodId,batchId,revision,db,fetch,planIds));}
/** One bounded request saves the entire batch, then previews the explicitly chosen employees. */
export async function saveAndPreviewWorkBatchAction(periodId:string,drafts:WorkDraft[],existing:{id:string;revision:number}|undefined,employeeIds:string[]) {
 const actor=await requireAdminActor();return payrollActionResult(async()=>{
  if(!employeeIds.length||employeeIds.some(id=>!drafts.some(d=>d.employeeId===id)))throw new PayrollValidationError("Select complete employee plans for review.");
  const saved=await db.transaction(tx=>saveWorkDraft(tx,actor.userId,periodId,drafts.map(d=>({...d,ownerId:d.ownerId||actor.userId})),existing));
  const plans=await db.select({id:workPlans.id,employeeId:workPlans.employeeId}).from(workPlans).where(eq(workPlans.batchId,saved.id));
  const result=await payrollActionResult(()=>prepareWorkApproval(periodId,saved.id,saved.revision,db,fetch,plans.filter(p=>employeeIds.includes(p.employeeId)).map(p=>p.id)));
  return {saved,preview:result.ok?result.data:null,error:result.ok?null:result.error};
 });
}
export async function approveWorkBatchAction(periodId:string,batchId:string,revision:number,digest:string,planIds?:string[]) {
 const actor=await requireAdminActor();return payrollActionResult(async()=>{
  await approveWorkBatch(actor.userId,periodId,batchId,revision,digest,db,fetch,planIds);
  // The transaction has committed. A failed display/status read must not turn its receipt into an approval error.
  let completion:AttendanceCompletion={decision:"approved",attendance:"pending",payroll:"unchanged",message:"Decision saved. Check attendance update status; payroll has not been recalculated.",affectedPeriodIds:[],pendingPeriodIds:[],adjustmentPeriodIds:[]};
  try{
   const approvedPlanIds=planIds??(await db.select({id:workPlans.id}).from(workPlans).where(eq(workPlans.batchId,batchId))).map(p=>p.id);
   completion=await attendanceBatchCompletion(periodId,batchId,approvedPlanIds);
   revalidatePath("/payroll/attendance-source");
  }catch{/* The exact plan IDs allow a later read-only status check and safe DTR retry. */}
  return {approved:true,batchId,completed:0,remaining:0,completion};
 });
}
export async function getWorkBatchCompletionAction(periodId:string,batchId:string,planIds:string[]) {
 await requireAdminActor();return payrollActionResult(()=>attendanceBatchCompletion(periodId,batchId,planIds));
}
/** A retry checks the durable result first, and can only update local attendance summaries. */
export async function refreshWorkBatchAttendanceAction(periodId:string,batchId:string,planIds:string[]) {
 const actor=await requireAdminActor();return payrollActionResult(async()=>{
  const saved=await attendanceBatchCompletion(periodId,batchId,planIds);
  if(saved.attendance!=="pending")return saved;
  for(const affected of saved.pendingPeriodIds)await refreshAttendanceDecisionDtr({actor:actor.userId,periodId:affected,batchId,planIds});
  revalidatePath("/payroll/attendance-source");
  return attendanceBatchCompletion(periodId,batchId,planIds);
 });
}
export async function retryWorkBatchAction(batchId:string) {const actor=await requireAdminActor();return payrollActionResult(async()=>{after(async()=>{try{await processWorkDelivery(actor.userId,{batchId});}catch{/* Retain durable delivery for status check and retry. */}});revalidatePath("/payroll/attendance-source");return {completed:0,remaining:0,queued:true};});}
export async function refreshWorkBoardAction(periodId:string) {await requireAdminActor();return payrollActionResult(()=>loadWorkBoard(periodId));}
export async function closeAttendanceAdjustmentAction(id:string,reference:string,conclusion:string,confirmed:boolean) {const actor=await requireAdminActor();return payrollActionResult(async()=>{await db.transaction(tx=>closeAdjustment(tx,actor.userId,id,reference,conclusion,confirmed));revalidatePath("/payroll/attendance-source");return "Adjustment evidence recorded. Posted payroll is unchanged.";});}
export async function reopenWorkPlanAction(id:string) {const actor=await requireAdminActor();return payrollActionResult(()=>db.transaction(tx=>reopenWorkPlan(tx,actor.userId,id)));}
export async function archiveWorkDraftAction(id:string,expectedUpdatedAt:string,note:string) {const actor=await requireAdminActor();return payrollActionResult(async()=>{const result=await db.transaction(tx=>archiveWorkDraft(tx,actor.userId,id,expectedUpdatedAt,note));revalidatePath("/payroll/attendance-source");return result;});}
export async function undoWorkPlanAction(id:string) {const actor=await requireAdminActor();return payrollActionResult(()=>undoWorkDraft(db,actor.userId,id));}
export async function keepAdminAttendanceAction(periodId:string,employeeId:string,day:string,incomingDigest:string) {
 const actor=await requireAdminActor();return payrollActionResult(()=>db.transaction(async tx=>{
  await lockAttendancePayrollInput(tx);
  const board=await loadWorkBoard(periodId,tx),current=board.employees.find(p=>p.id===employeeId)?.days.find(d=>d.day===day)?.decision;
  if(!current||current.incomingDigest!==incomingDigest)throw new PayrollValidationError("Incoming attendance changed. Refresh the comparison before keeping the decision.");
  const rows=current.planId?await tx.select().from(workTreatments).where(and(eq(workTreatments.planId,current.planId),eq(workTreatments.periodId,periodId),eq(workTreatments.active,true))):[];
  for(const row of rows){const decision=adminDecision(row.payload);if(decision)await tx.update(workTreatments).set({payload:{...decision,keptIncomingDigest:incomingDigest}}).where(eq(workTreatments.id,row.id));}
  await tx.insert(workHistory).values({planId:current.planId??null,actor:actor.userId,action:current.planId?"Kept admin decision":"Kept payroll attendance",details:{periodId,employeeId,day,payrollRunId:current.payrollRunId,incomingDigest,reason:"approved"}});
  return "Admin decision retained. Attendance totals and payroll are unchanged.";
 }));
}
export async function attendanceScheduleOptionsAction() {
 await requireAdminActor();return (await fetchShiftTables()).sort(compareShiftTableSchedules).map(row=>({id:row.id,code:row.code,name:row.description,start:row.regularStartTime,end:row.regularEndTime,label:shiftTableScheduleLabel(row)}));
}
