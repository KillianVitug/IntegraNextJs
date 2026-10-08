"use server";

import { revalidatePath } from "next/cache";
import { archiveWeeklySchedule, mutatePeriodSchedule, readScheduleReceipt, readScheduleWorkspace, requireScheduleActor, saveWeeklySchedules } from "@/lib/scheduling/service";
import type { ScheduleActionResult, ScheduleArchiveCommand, SchedulePeriodCommand, ScheduleReceipt, ScheduleWeeklyCommand, ScheduleWorkspaceQuery } from "@/lib/scheduling/workspace-types";

export async function getScheduleWorkspace(query: ScheduleWorkspaceQuery = {}) { return readScheduleWorkspace(await requireScheduleActor(), query); }
async function run(action: () => Promise<ScheduleReceipt>): Promise<ScheduleActionResult> {
  try { const receipt = await action(); revalidatePath("/schedules"); return { ok: true, receipt }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The schedule action failed. Check its status before retrying." }; }
}
export async function saveScheduleDraft(input: SchedulePeriodCommand) { return run(async () => mutatePeriodSchedule(await requireScheduleActor(), input, "draft_saved")); }
export async function confirmScheduleDraft(input: SchedulePeriodCommand) { return run(async () => mutatePeriodSchedule(await requireScheduleActor(), input, "confirmed")); }
export async function deleteScheduleDraft(input: SchedulePeriodCommand) { return run(async () => mutatePeriodSchedule(await requireScheduleActor(), input, "draft_deleted")); }
export async function saveWeeklyDefaults(input: ScheduleWeeklyCommand) { return run(async () => saveWeeklySchedules(await requireScheduleActor(), input)); }
export async function archiveWeeklyDefault(input: ScheduleArchiveCommand) { return run(async () => archiveWeeklySchedule(await requireScheduleActor(), input)); }
export async function getScheduleRequestReceipt(requestId: string) { return readScheduleReceipt(await requireScheduleActor(), requestId); }
