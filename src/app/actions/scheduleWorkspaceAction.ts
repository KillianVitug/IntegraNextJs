"use server";

import { revalidatePath } from "next/cache";
import { archiveWeeklySchedule, cancelScheduleOperationRequest as cancelOperation, confirmScopedScheduleDays, mutatePeriodSchedule, readScheduleDayRepair, readScheduleDayOperations, readScheduleDayHistory, readScheduleReceipt, readScheduleWorkspace, requireScheduleActor, saveWeeklySchedules, submitScheduleDayOperation as submitOperation } from "@/lib/scheduling/service";
import type { ScheduleActionResult, ScheduleArchiveCommand, SchedulePeriodCommand, ScheduleReceipt, ScheduleWeeklyCommand, ScheduleWorkspaceQuery, ScheduleDayOperationCommand, ScheduleDayOperations, ScheduleDayHistoryPage } from "@/lib/scheduling/workspace-types";
import { PayrollValidationError } from "@/lib/payroll/validation";
import { ZodError } from "zod";
import { db } from "@/db";

const publicError=(error:unknown)=>error instanceof PayrollValidationError?error.message:error instanceof ZodError?"Check the selected employee, date, schedule and optional note, then try again.":"The schedule action could not finish. Your entries are retained. Check its saved status before retrying.";
async function read<T>(operation:()=>Promise<T>) {try{return await operation();}catch(error){if(error&&typeof error==="object"&&"digest" in error&&String(error.digest).startsWith("NEXT_REDIRECT"))throw error;throw new Error(publicError(error));}}
export async function getScheduleWorkspace(query: ScheduleWorkspaceQuery = {}) { return read(async()=>readScheduleWorkspace(await requireScheduleActor(), query)); }
export async function getScheduleDayRepair(query: {employeeId:string;day:string;periodId?:string}) { return read(async()=>readScheduleDayRepair(await requireScheduleActor(), query)); }
export async function getScheduleDayOperations(query:{employeeId:string;day:string;periodId?:string}):Promise<ScheduleDayOperations> {return read(async()=>{const actor=await requireScheduleActor();return db.transaction(tx=>readScheduleDayOperations(actor,query,tx),{isolationLevel:"repeatable read",accessMode:"read only"});});}
export async function getScheduleDayHistory(query:{employeeId:string;day:string;periodId?:string;cursor?:string}):Promise<ScheduleDayHistoryPage> {return read(async()=>{const actor=await requireScheduleActor();return db.transaction(tx=>readScheduleDayHistory(actor,query,tx),{isolationLevel:"repeatable read",accessMode:"read only"});});}
async function run(action: () => Promise<ScheduleReceipt>): Promise<ScheduleActionResult> {
  try { const receipt = await action(); try { for(const path of ["/schedules","/managerProvisional","/managerHome","/home/schedule-requests"])revalidatePath(path); } catch { /* The committed receipt remains authoritative. */ } return { ok: true, receipt }; }
  catch (error) { return { ok: false, error: publicError(error), uncertain:!(error instanceof PayrollValidationError||error instanceof ZodError) }; }
}
export async function saveScheduleDraft(input: SchedulePeriodCommand) { return run(async () => mutatePeriodSchedule(await requireScheduleActor(), input, "draft_saved")); }
export async function confirmScheduleDraft(input: SchedulePeriodCommand) { return run(async () => mutatePeriodSchedule(await requireScheduleActor(), input, "confirmed")); }
export async function confirmScheduleDays(input: SchedulePeriodCommand) { return run(async () => confirmScopedScheduleDays(await requireScheduleActor(), input)); }
export async function deleteScheduleDraft(input: SchedulePeriodCommand) { return run(async () => mutatePeriodSchedule(await requireScheduleActor(), input, "draft_deleted")); }
export async function saveWeeklyDefaults(input: ScheduleWeeklyCommand) { return run(async () => saveWeeklySchedules(await requireScheduleActor(), input)); }
export async function archiveWeeklyDefault(input: ScheduleArchiveCommand) { return run(async () => archiveWeeklySchedule(await requireScheduleActor(), input)); }
export async function getScheduleRequestReceipt(requestId: string) { return read(async()=>readScheduleReceipt(await requireScheduleActor(), requestId)); }
export async function submitScheduleDayOperation(input:ScheduleDayOperationCommand) {return run(async()=>submitOperation(await requireScheduleActor(),input));}
export async function cancelScheduleOperationRequest(input:{requestId:string}) {return run(async()=>cancelOperation(await requireScheduleActor(),input.requestId));}
