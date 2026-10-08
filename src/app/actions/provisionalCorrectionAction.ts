"use server";
import { requireAdminActor } from "@/lib/admin";
import { prepareWorkApproval } from "@/lib/payroll/attendanceWorkbench";
import { payrollActionResult } from "@/lib/payroll/validation";
import { saveProvisionalCorrectionDraft } from "@/lib/payroll/provisionalCorrection";
import type { WorkDraft } from "@/lib/payroll/attendanceWorkbenchModel";

/** The request ID is the batch identity. A lost response is recovered before another save. */
export async function previewProvisionalCorrectionAction(input: { requestId: string; periodId: string; expectedRevision?: number; draft: WorkDraft }) {
  const actor = await requireAdminActor();
  return payrollActionResult(async () => {
    const saved = await saveProvisionalCorrectionDraft(actor, input);
    // Saving and reviewing are separate outcomes; a validation error retains the exact draft receipt.
    const reviewed = await payrollActionResult(() => prepareWorkApproval(input.periodId, saved.id, saved.revision));
    return { saved, preview: reviewed.ok ? { batchId: reviewed.data.batchId, revision: reviewed.data.revision, digest: reviewed.data.digest, plans: reviewed.data.prepared.map(plan => ({ id: plan.id, warnings: plan.preview.warnings, records: plan.preview.records, periods: plan.periodEvidence.map(period => ({ id: period.id, code: period.code, posted: period.posted })) })) } : null, error: reviewed.ok ? null : reviewed.error };
  });
}
