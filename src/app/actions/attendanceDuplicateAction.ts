"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireAdminActor } from "@/lib/admin";
import { requireAttendanceSource } from "@/lib/payroll/attendanceSourceSync";
import { payrollActionResult } from "@/lib/payroll/validation";
import { loadDuplicateBoard, setDuplicatePolicy, approveDuplicateBatch, undoDuplicate } from "@/lib/payroll/attendanceDuplicates";
import type { DuplicateMode } from "@/lib/payroll/attendanceDuplicateModel";

export async function duplicateBoardAction(periodId:string) {
 await requireAdminActor();requireAttendanceSource();return payrollActionResult(()=>loadDuplicateBoard(periodId));
}
export async function duplicatePolicyAction(mode:DuplicateMode,revision:string,confirmed:boolean) {
 const actor=await requireAdminActor();requireAttendanceSource();
 return payrollActionResult(async()=>{await db.transaction(tx=>setDuplicatePolicy(tx,actor.userId,mode,revision,confirmed));revalidatePath("/payroll/attendance-source");return mode==="Automatic"?"Automatic handling enabled for future captures only. Upload, sequence and payroll checks still apply. Historical records require approval.":`Duplicate handling saved: ${mode==="Off"?"Off":"Suggest only"}. Existing history is retained.`;});
}
export async function approveDuplicateBatchAction(periodId:string,selection:{id:string;version:string}[],reason:string,confirmed:boolean) {
 const actor=await requireAdminActor();requireAttendanceSource();
 return payrollActionResult(async()=>{const result=await approveDuplicateBatch(periodId,selection,reason,confirmed,actor.userId);revalidatePath("/payroll/attendance-source");revalidatePath("/payroll");return result.message;});
}
export async function undoDuplicateAction(id:string,reason:string) {
 const actor=await requireAdminActor();requireAttendanceSource();
 return payrollActionResult(async()=>{const message=await undoDuplicate(id,reason,actor.userId);revalidatePath("/payroll/attendance-source");revalidatePath("/payroll");return message;});
}
