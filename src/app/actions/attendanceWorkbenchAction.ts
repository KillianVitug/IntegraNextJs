"use server";
import { requireAdminActor } from "@/lib/admin";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { saveWorkDraft, prepareWorkApproval, approveWorkBatch, loadWorkBoard } from "@/lib/payroll/attendanceWorkbench";
import { processWorkDelivery, closeAdjustment, reopenWorkPlan, undoWorkDraft } from "@/lib/payroll/attendanceWorkbenchDelivery";
import { payrollActionResult } from "@/lib/payroll/validation";
import type { WorkDraft } from "@/lib/payroll/attendanceWorkbenchModel";
import { and, eq } from "drizzle-orm";
import { workTreatments, workHistory } from "@/db/attendanceWorkbenchSchema";
import { shiftTables } from "@/db/schema";
import { adminDecision } from "@/lib/payroll/attendanceAdminDecision";
import { lockAttendancePayrollInput } from "@/lib/payroll/attendanceSourceGuard";
import { PayrollValidationError } from "@/lib/payroll/validation";
export async function saveWorkDraftAction(periodId:string,drafts:WorkDraft[],existing?:{id:string;revision:number}) {const actor=await requireAdminActor();return payrollActionResult(()=>db.transaction(tx=>saveWorkDraft(tx,actor.userId,periodId,drafts.map(d=>({...d,ownerId:d.ownerId||actor.userId})),existing)));}
export async function previewWorkBatchAction(periodId:string,batchId:string,revision:number,planIds?:string[]) {await requireAdminActor();return payrollActionResult(()=>prepareWorkApproval(periodId,batchId,revision,db,fetch,planIds));}
export async function approveWorkBatchAction(periodId:string,batchId:string,revision:number,digest:string,planIds?:string[]) {
 const actor=await requireAdminActor();return payrollActionResult(async()=>{
  await approveWorkBatch(actor.userId,periodId,batchId,revision,digest,db,fetch,planIds);
  after(async()=>{try{await processWorkDelivery(actor.userId,{batchId});}catch{/* Durable jobs remain available to scheduler and retry. */}});
  revalidatePath("/payroll/attendance-source");return {approved:true,batchId,completed:0,remaining:0};
 });
}
export async function retryWorkBatchAction(batchId:string) {const actor=await requireAdminActor();return payrollActionResult(async()=>{after(async()=>{try{await processWorkDelivery(actor.userId,{batchId});}catch{/* Retain durable delivery for status check and retry. */}});revalidatePath("/payroll/attendance-source");return {completed:0,remaining:0,queued:true};});}
export async function refreshWorkBoardAction(periodId:string) {await requireAdminActor();return payrollActionResult(()=>loadWorkBoard(periodId));}
export async function closeAttendanceAdjustmentAction(id:string,reference:string,conclusion:string,confirmed:boolean) {const actor=await requireAdminActor();return payrollActionResult(async()=>{await db.transaction(tx=>closeAdjustment(tx,actor.userId,id,reference,conclusion,confirmed));revalidatePath("/payroll/attendance-source");return "Adjustment evidence recorded. Posted payroll is unchanged.";});}
export async function reopenWorkPlanAction(id:string) {const actor=await requireAdminActor();return payrollActionResult(()=>db.transaction(tx=>reopenWorkPlan(tx,actor.userId,id)));}
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
 await requireAdminActor();return db.select({id:shiftTables.id,code:shiftTables.code,name:shiftTables.description,start:shiftTables.regularStartTime,end:shiftTables.regularEndTime}).from(shiftTables);
}
