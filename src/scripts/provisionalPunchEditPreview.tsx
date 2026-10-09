import React from "react";
import { createRoot } from "react-dom/client";
import { DayCorrection } from "@/app/(ntg)/payroll/provisional/day-correction";
import type { AttendanceDayInput } from "@/lib/payroll/attendanceDayInput";
import { changeInputErrors, simulateWork, type WorkBoard, type WorkDraft, type WorkEmployee, type WorkRecord } from "@/lib/payroll/attendanceWorkbenchModel";

// This entry point is bundled only by the isolated component-verification harness.
// Every read/action import from DayCorrection must be replaced with these fixtures.
const day = "2026-10-02", employeeId = "fictional-inline-punch-employee";
const records: WorkRecord[] = ["00:01:27.000", "03:27:11.000", "09:02:29.000"].map((time, index) => ({ id: `fictional-capture-${index + 1}`, source: "API", employeeId, type: "IN", at: `${day}T${time}Z`, status: "VALID", clockFlag: false }));
records[0] = { ...records[0], originalAt: `${day}T00:00:30.000Z`, originalType: "IN" };
const attendance: AttendanceDayInput = {
  punches: records.map((record, index) => ({ id: record.id, type: record.type, at: record.at, included: false, reason: index ? "Repeated IN needs review; Missing OUT" : "Missing OUT" })),
  issues: ["Missing OUT", "Repeated IN needs review; Missing OUT", "Missing OUT"],
  missingDirection: "OUT", complete: false, canConfirmExisting: false,
};
const employee: WorkEmployee = {
  id: employeeId, no: "PV-001", name: "Fictional Employee", sourceIds: [], mappingEvidence: {}, hired: null, separated: null,
  contextRecords: records,
  days: [{ day, schedule: { checkInTime: "08:00", checkOutTime: "17:00", hoursPerDay: 8, breakMinutes: 60 }, rest: false, leave: 0, leaveEvidence: [], configuration: {}, records, status: "Needs review", issues: attendance.issues, suggestions: [], version: "fictional-original-version", resolved: false, attendance }],
};
const period: WorkBoard["period"] = { id: "fictional-inline-punch-period", code: "Fictional October A", startDate: "2026-10-01", endDate: "2026-10-15", posted: false };
export const fixture = { day, employeeId, records, employee, period, storage: `integra-provisional-correction:${period.id}:${employeeId}:${day}` };
export const previewState = { calls: [] as { name: string; input?: unknown }[], revision: 0, approved: false, savedCallbacks: 0, interruptReview: false, interruptRead: false };
const recordCall = (name: string, input?: unknown) => { previewState.calls.push({ name, input: structuredClone(input) }); };

export async function mockRead(resource: string, input: unknown) {
  recordCall("read", { resource, input });
  if (previewState.interruptRead) throw new Error("Fictional interrupted read");
  return structuredClone(employee);
}
export async function mockPreview(input: { requestId: string; draft: WorkDraft }) {
  recordCall("review", input);
  if (previewState.interruptReview) throw new Error("Fictional interrupted review");
  const errors = input.draft.changes.flatMap(change => changeInputErrors(input.draft, change));
  previewState.revision += 1;
  const saved = { id: input.requestId, revision: previewState.revision };
  if (errors.length) return { ok: true, data: { saved, preview: null, error: errors.join("; ") } };
  const simulated = simulateWork(records, input.draft.changes, employeeId);
  if (simulated.errors.length) return { ok: true, data: { saved, preview: null, error: simulated.errors.join("; ") } };
  return { ok: true, data: { saved, error: null, preview: { batchId: input.requestId, revision: previewState.revision, digest: `fictional-digest-${previewState.revision}`, plans: [{ id: "fictional-plan", warnings: ["Fictional preview — verify remaining attendance findings before confirming."], records: simulated.records, periods: [{ id: period.id, code: period.code, posted: false }] }] } } };
}
export async function mockCompletion(...input: unknown[]) {
  recordCall("completion", input);
  return previewState.approved ? { ok: true, data: {} } : { ok: false, error: "Fictional correction has not been confirmed" };
}
export async function mockApprove(...input: unknown[]) {
  recordCall("confirm", input);
  previewState.approved = true;
  return { ok: true, data: {} };
}
export async function mockRefresh(...input: unknown[]) {
  recordCall("refresh", input);
  return { ok: true, data: { attendance: "updated", message: "Fictional attendance update completed." } };
}
Object.assign(window, { punchPreview: { fixture, previewState, mockRead, mockPreview, mockCompletion, mockApprove, mockRefresh } });
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-7xl p-3 sm:p-6">
    <p className="mb-4 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-slate-900">Fictional component preview · reads, review and confirmation are simulated. No payroll connection.</p>
    <DayCorrection period={period} employeeId={employeeId} day={day} reviewHref="#fictional-history" onSaved={async () => { recordCall("saved"); previewState.savedCallbacks += 1; }} />
  </main>,
);
