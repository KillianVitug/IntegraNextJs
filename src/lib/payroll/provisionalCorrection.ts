import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { workBatches, workPlans } from "@/db/attendanceWorkbenchSchema";
import { saveWorkDraft } from "./attendanceWorkbench";
import { lockAttendancePayrollInput } from "./attendanceSourceGuard";
import { resolutionDigest } from "./attendanceResolution";
import { PayrollValidationError } from "./validation";
import type { WorkDraft } from "./attendanceWorkbenchModel";

const scope = z.object({ requestId: z.string().uuid(), periodId: z.string().uuid(), expectedRevision: z.number().int().positive().optional() });
export type ProvisionalCorrectionCommand = z.infer<typeof scope> & { draft: WorkDraft };
// JSONB orders object keys and drops undefined fields. Use the same canonical JSON
// content after a lost response instead of treating serialization order as an edit.
const content = (draft: WorkDraft) => resolutionDigest(JSON.parse(JSON.stringify({ ...draft, ownerId: "" })));

/** Save one isolated employee-day request. The caller authenticates the actor. */
export async function saveProvisionalCorrectionDraft(actor: { userId: string }, input: ProvisionalCorrectionCommand, database: typeof db = db) {
  const command = scope.parse(input);
  const draft = { ...input.draft, ownerId: actor.userId };
  if (!Array.isArray(draft.days) || draft.days.length !== 1 || !Array.isArray(draft.changes) || !draft.changes.length || draft.changes.some(change => change.day !== draft.days[0] || ["Employee", "UndoCapture", "ReopenDay"].includes(change.kind)) || draft.undoOf || draft.replaces || Object.keys(draft.incomingVersions ?? {}).length) throw new PayrollValidationError("Use this editor for one employee and workday. Open attendance review for reassignment or incoming evidence.");
  return database.transaction(async tx => {
    await lockAttendancePayrollInput(tx);
    const [prior] = await tx.select().from(workBatches).where(eq(workBatches.id, command.requestId)).for("update");
    if (prior) {
      if (prior.actor !== actor.userId || prior.periodId !== command.periodId || prior.state !== "Draft") throw new PayrollValidationError("This correction request has changed. Check its saved status before continuing.");
      const plans = await tx.select().from(workPlans).where(eq(workPlans.batchId, prior.id));
      const original = plans[0]?.draft as WorkDraft | undefined;
      if (plans.length !== 1 || plans[0].employeeId !== draft.employeeId || original?.employeeId !== draft.employeeId || original.days.length !== 1 || original.days[0] !== draft.days[0]) throw new PayrollValidationError("This request belongs to another employee, workday or saved batch. Open its attendance review; no existing plans were changed.");
      if (content(original) === content(draft)) return { id: prior.id, revision: prior.revision };
      if (prior.revision !== command.expectedRevision) throw new PayrollValidationError("Another saved revision exists. Reopen attendance review to compare it; your entries are retained.");
      return saveWorkDraft(tx, actor.userId, command.periodId, [draft], { id: prior.id, revision: prior.revision });
    }
    if (command.expectedRevision) throw new PayrollValidationError("The saved correction is unavailable. Check attendance history.");
    return saveWorkDraft(tx, actor.userId, command.periodId, [draft], undefined, command.requestId);
  });
}
