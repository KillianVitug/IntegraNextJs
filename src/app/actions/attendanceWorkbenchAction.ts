"use server";
import { requireAdminActor } from "@/lib/admin";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { saveWorkDraft, prepareWorkApproval, approveWorkBatch, loadWorkBoard } from "@/lib/payroll/attendanceWorkbench";
import { processWorkDelivery, closeAdjustment, reopenWorkPlan, undoWorkDraft } from "@/lib/payroll/attendanceWorkbenchDelivery";
import { payrollActionResult } from "@/lib/payroll/validation";
import type { WorkDraft } from "@/lib/payroll/attendanceWorkbenchModel";
export async function saveWorkDraftAction(periodId:string,drafts:WorkDraft[],existing?:{id:string;revision:number}) {const actor=await requireAdminActor();return payrollActionResult(()=>db.transaction(tx=>saveWorkDraft(tx,actor.userId,periodId,drafts.map(d=>({...d,ownerId:d.ownerId||actor.userId})),existing)));}
export async function previewWorkBatchAction(periodId:string,batchId:string,revision:number) {await requireAdminActor();return payrollActionResult(()=>prepareWorkApproval(periodId,batchId,revision));}
export async function approveWorkBatchAction(periodId:string,batchId:string,revision:number,digest:string) {const actor=await requireAdminActor();return payrollActionResult(async()=>{await approveWorkBatch(actor.userId,periodId,batchId,revision,digest);const result=await processWorkDelivery(actor.userId,{batchId});revalidatePath("/payroll/attendance-source");return result;});}
export async function retryWorkBatchAction(batchId:string) {const actor=await requireAdminActor();return payrollActionResult(async()=>{const result=await processWorkDelivery(actor.userId,{batchId});revalidatePath("/payroll/attendance-source");return result;});}
export async function refreshWorkBoardAction(periodId:string) {await requireAdminActor();return payrollActionResult(()=>loadWorkBoard(periodId));}
export async function closeAttendanceAdjustmentAction(id:string,reference:string,conclusion:string,confirmed:boolean) {const actor=await requireAdminActor();return payrollActionResult(async()=>{await db.transaction(tx=>closeAdjustment(tx,actor.userId,id,reference,conclusion,confirmed));revalidatePath("/payroll/attendance-source");return "Adjustment evidence recorded. Posted payroll is unchanged.";});}
export async function reopenWorkPlanAction(id:string) {const actor=await requireAdminActor();return payrollActionResult(()=>db.transaction(tx=>reopenWorkPlan(tx,actor.userId,id)));}
export async function undoWorkPlanAction(id:string) {const actor=await requireAdminActor();return payrollActionResult(()=>undoWorkDraft(db,actor.userId,id));}
