"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { previewProvisionalCorrectionAction } from "@/app/actions/provisionalCorrectionAction";
import { approveWorkBatchAction, getWorkBatchCompletionAction, refreshWorkBatchAttendanceAction } from "@/app/actions/attendanceWorkbenchAction";
import { payrollRead } from "@/lib/payroll/readClient";
import { generateUUID } from "@/lib/uuid";
import { appendManualDraft, buildNoWorkDrafts } from "@/lib/payroll/attendanceStage6Model";
import { draftVersion, type WorkBoard, type WorkChange, type WorkDraft, type WorkEmployee, type WorkKind, type WorkRecord } from "@/lib/payroll/attendanceWorkbenchModel";
import { changesForPunch, removeDraftChanges, upsertPunchChange } from "@/lib/payroll/provisionalPunchEdits";
import { formatWorkday } from "@/lib/payroll/dateDisplay";
import { originalPunchDateTime } from "@/lib/payroll/attendanceResolutionModel";
import { BatchReview } from "../attendance-source/batch-review";
import { QuickPunch } from "../attendance-source/quick-punch";
import { PunchReview } from "./punch-review";

type Preview = NonNullable<Extract<Awaited<ReturnType<typeof previewProvisionalCorrectionAction>>, { ok: true }>["data"]["preview"]>;
type SavedState = { requestId: string; draft: WorkDraft | null; revision?: number; preview: Preview | null; approved: boolean };
const button = "min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-600";
const primary = `${button} bg-blue-700 text-white`;

export function DayCorrection({ period, employeeId, day, reviewHref, onSaved, payrollHold, holdHref, scheduledNoAttendance, attendanceDetailsHref }: { period: WorkBoard["period"]; employeeId: string; day: string; reviewHref: string; onSaved: (outcome?: string) => Promise<void>; payrollHold?: boolean; holdHref?: string; scheduledNoAttendance?: boolean; attendanceDetailsHref?: string }) {
  const storage = `integra-provisional-correction:${period.id}:${employeeId}:${day}`;
  const [employee, setEmployee] = useState<WorkEmployee | null>(null);
  const [state, setState] = useState<SavedState>({ requestId: "", draft: null, preview: null, approved: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [estimated, setEstimated] = useState(false);
  const [addPunch, setAddPunch] = useState(false), [ready, setReady] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null), previewRef=useRef<HTMLDivElement>(null), gate = useRef(false);
  function retain(next: SavedState) { setState(next); try { sessionStorage.setItem(storage, JSON.stringify(next)); } catch { /* Server receipts remain available in attendance history. */ } }
  useEffect(() => {
    let disposed = false;
    try { const saved = JSON.parse(sessionStorage.getItem(storage) ?? "null") as SavedState | null; setState(saved?.requestId ? saved : { requestId: generateUUID(), draft: null, preview: null, approved: false }); } catch { setState({ requestId: generateUUID(), draft: null, preview: null, approved: false }); }
    setReady(true);
    payrollRead<WorkEmployee | null>("employee", { periodId: period.id, employeeId }).then(value => { if (!disposed) { setEmployee(value); if (!value) setError("This employee is unavailable for the selected period."); } }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : "Attendance could not load."); });
    return () => { disposed = true; };
  }, [storage, employeeId, period.id]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(()=>{if(state.preview&&!state.approved){previewRef.current?.focus();previewRef.current?.scrollIntoView({block:"start"});}},[state.preview,state.approved]);
  const currentDay = employee?.days.find(value => value.day === day);
  const attendance = currentDay?.attendance;
  const showAddPunch = addPunch;
  const inlineChangeIds = currentDay?.records.flatMap(record => changesForPunch(state.draft, record, day).map(change => change.id)) ?? [];
  const additionalChanges = state.draft?.changes.filter(change => !inlineChangeIds.includes(change.id)) ?? [];
  const board: WorkBoard = { period, employees: employee ? [employee] : [], plans: [], adjustments: [], owners: [], statuses: { sync: "", review: "", delivery: "", dtr: "", payroll: "" }, enabled: true };
  function changeDraft(draft: WorkDraft | null) { retain({ ...state, draft, preview: null }); setError(""); setNotice(""); }
  function editChange(_employeeId: string, id: string, patch: Partial<WorkChange>) {
    if (state.draft) changeDraft({ ...state.draft, changes: state.draft.changes.map(change => change.id === id ? { ...change, ...patch } : change) });
  }
  function add(kind: WorkKind, record?: WorkRecord) {
    if (!employee) return;
    try {
      if (kind === "NoAttendance") { changeDraft(buildNoWorkDrafts(state.draft ? [state.draft] : [], [employee], [{ employeeId, day }], "", generateUUID)[0]); return; }
      const base = state.draft ?? { employeeId, days: [day], changes: [], reason: "", ownerId: "", needed: "", rejected: false, version: draftVersion(employee, [day]) };
      const target = record ? record.source === "API" ? { eventId: record.id } : { rawLogId: record.rawLogId } : {};
      const change = { id: generateUUID(), day, kind, ...target, ...(kind === "Direction" ? { type: record?.type === "IN" ? "OUT" as const : "IN" as const } : {}), reason: "", evidence: "", verified: false };
      changeDraft(record ? upsertPunchChange(base, change) : { ...base, changes: [...base.changes, change] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This change could not be added."); }
  }
  async function review(draft = state.draft) {
    if (!draft || gate.current) return;
    gate.current = true; setBusy(true); setError(""); retain({ ...state, draft, preview: null });
    try {
      const result = await previewProvisionalCorrectionAction({ requestId: state.requestId, periodId: period.id, expectedRevision: state.revision, draft });
      if (!result.ok) { setError(result.error); return; }
      retain({ ...state, draft, revision: result.data.saved.revision, preview: result.data.preview });
      setNotice(result.data.preview ? "Review this employee’s exact changes below. Nothing is approved yet." : "Draft saved. Complete the information below.");
      if (result.data.error) setError(result.data.error);
    } catch { setError("The review response was interrupted. Retry review to recover this same saved request; no correction has been approved."); }
    finally { gate.current = false; setBusy(false); }
  }
  async function reviewExisting() {
    if (!employee || !attendance?.canConfirmExisting || state.draft) return;
    await review({ employeeId, days: [day], changes: [{ id: generateUUID(), day, kind: "ConfirmSequence", reason: "", evidence: "", verified: false }], reason: "", ownerId: "", needed: "", rejected: false, version: draftVersion(employee, [day]) });
  }
  async function finish(preview: Preview) {
    retain({ ...state, preview, approved: true }); setNotice("Correction saved. Updating attendance and estimate…");
    const result = await refreshWorkBatchAttendanceAction(period.id, preview.batchId, preview.plans.map(plan => plan.id));
    if (!result.ok) { setError(`Correction saved. Attendance update needs retry: ${result.error}`); return; }
    if (result.data.attendance === "pending") { setError("Correction saved. Attendance update is still pending; retry the update below."); return; }
    setNotice(result.data.message + " Updating estimate…");
    await onSaved(result.data.attendance === "adjustment-required" ? "Correction saved for adjustment review. Posted payroll is unchanged; the latest estimate is displayed separately." : undefined); setEstimated(true);
    try { sessionStorage.removeItem(storage); } catch { /* The approved receipt remains in server history. */ }
    setNotice(result.data.attendance === "adjustment-required" ? "Correction saved for adjustment review. Posted payroll is unchanged; the latest estimate is displayed separately." : "Correction saved · Attendance updated · Estimate updated. Payroll is unchanged.");
  }
  async function approve() {
    const preview = state.preview;
    if (!preview || gate.current) return;
    gate.current = true; setBusy(true); setError("");
    try {
      if (state.approved) { await finish(preview); return; }
      const recovered = await getWorkBatchCompletionAction(period.id, preview.batchId, preview.plans.map(plan => plan.id));
      if (!recovered.ok) {
        const result = await approveWorkBatchAction(period.id, preview.batchId, preview.revision, preview.digest, preview.plans.map(plan => plan.id));
        if (!result.ok) { setError(result.error); return; }
      }
      await finish(preview);
    } catch {
      try {
        const found = await getWorkBatchCompletionAction(period.id, preview.batchId, preview.plans.map(plan => plan.id));
        if (found.ok) { retain({ ...state, preview, approved: true }); setNotice("Correction saved. The response was interrupted; payroll is unchanged."); setError("Attendance or estimate update is pending. Retry the update, without approving again."); }
        else setError("The response was interrupted. Saved status was checked. Retry confirmation to check again before any approval.");
      } catch { setError("The response and saved-status check were interrupted. Retry checks this same request before any approval."); }
    } finally { gate.current = false; setBusy(false); }
  }
  if (!ready) return <p role="status">Loading correction…</p>;
  return <section aria-label={`Attendance correction for ${formatWorkday(day)}`} className="min-w-0 space-y-3">
    <div><h2 className="text-xl font-semibold">Attendance · {formatWorkday(day)}</h2><p className="text-sm text-muted-foreground">{employee?.name} · Changes apply to this workday. Other saved plans stay intact.</p></div>
    {notice && <p role="status" className="rounded-lg border border-blue-300 p-3 text-sm">{notice}</p>}
    {error && <div ref={errorRef} tabIndex={-1} role="alert" className="space-y-2 rounded-lg border border-red-400 p-3 text-sm focus:ring-2 focus:ring-red-600"><p>{error}</p>{!state.approved&&<button disabled={busy} className={button} onClick={() => { setError(""); void payrollRead<WorkEmployee>("employee", { periodId: period.id, employeeId }).then(value=>{setEmployee(value);retain({...state,preview:null,draft:state.draft?{...state.draft,version:draftVersion(value,[day])}:null});setNotice("Current attendance reloaded. Your correction values are retained; review them again before confirming.");}).catch(() => setError("Attendance could not load. Retry here.")); }}>{employee?"Reload attendance for fresh review":"Retry attendance read"}</button>}</div>}
    {currentDay && !state.approved && <>
      {scheduledNoAttendance && <p className="rounded-lg border border-amber-400 p-3 text-sm">No attendance has been received for this scheduled workday. Check phone uploads before adding actual missing punches. If no work occurred, review the day status in attendance details.</p>}
      {payrollHold && <p className="rounded-lg border border-amber-400 p-3 text-sm">Attendance time is on hold by administrator decision. Editing punches does not release held time. {holdHref&&<Link className="underline" href={holdHref}>Review held-time decisions</Link>}</p>}
      {currentDay.decision?.lateConflict && <p className="rounded-lg border border-amber-400 p-3 text-sm">Incoming attendance differs. The approved decision remains in effect. <Link className="underline" href={reviewHref}>Keep the decision or review incoming attendance</Link>.</p>}
      {attendance && <div className={`rounded-lg border p-3 text-sm ${attendance.issues.length || currentDay.decision?.lateConflict ? "border-amber-400" : "border-emerald-400"}`}><p className="font-semibold">{attendance.complete && !attendance.issues.length ? currentDay.decision?.lateConflict ? "Approved attendance retained" : "Complete punch sequence" : attendance.missingDirection ? `Missing ${attendance.missingDirection} · Add the actual punch or correct an existing capture` : attendance.issues.length ? "Review the items below" : "No punches recorded"}</p>{attendance.issues.length>0&&<ul className="mt-1 list-inside list-disc">{[...new Set(attendance.issues)].map(issue=><li key={issue}>{issue}</li>)}</ul>}{attendance.canConfirmExisting&&!currentDay.decision?.lateConflict&&!state.draft&&<button className={`${primary} mt-2`} disabled={busy} onClick={()=>void reviewExisting()}>Review existing punches</button>}</div>}
      {employee && <PunchReview board={board} employee={employee} day={day} draft={state.draft} busy={busy} onAdd={add} editChange={editChange} onRemove={ids => state.draft && changeDraft(removeDraftChanges(state.draft, ids))} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!showAddPunch && !state.draft?.changes.some(change=>change.kind==="Manual") && <button className={button} disabled={busy} onClick={()=>{ changeDraft(state.draft); setAddPunch(true); }}>{attendance?.missingDirection ? `Add missing ${attendance.missingDirection}` : "Add missing IN or OUT"}</button>}
        {state.draft && !state.preview && <button className={primary} disabled={busy || !state.draft.changes.length} onClick={() => void review()}>{busy ? "Reviewing…" : `Review ${state.draft.changes.length} ${state.draft.changes.length === 1 ? "change" : "changes"}`}</button>}
      </div>
      {showAddPunch && employee && !state.preview && !state.draft?.changes.some(change=>change.kind==="Manual") && <QuickPunch key={`${day}:${attendance?.missingDirection || "IN"}`} day={day} busy={busy} initialDirection={attendance?.missingDirection || "IN"} onEdit={() => retain({ ...state, preview: null })} onReview={async (change, note) => { const draft = appendManualDraft(state.draft ? [state.draft] : [], employee, change, note)[0]; await review(draft); }} />}
      {state.draft && <details key={additionalChanges.map(change=>change.id).join("|")} open={additionalChanges.length > 0} className="min-w-0"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{additionalChanges.length ? `${additionalChanges.length} additional ${additionalChanges.length === 1 ? "change" : "changes"} · Plan details and day preview` : "Plan note, saved history and day preview"}</summary><BatchReview board={board} drafts={[state.draft]} busy={busy} hiddenChangeIds={inlineChangeIds} onChange={drafts => changeDraft(drafts[0] ?? null)} editDraft={(_id, patch) => state.draft && changeDraft({ ...state.draft, ...patch })} editChange={editChange} onNotice={setNotice} /></details>}
      <details><summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Other day actions</summary><button className={button} disabled={busy || !currentDay.records.some(record=>record.status==="VALID"&&!record.excluded)} onClick={() => add("NoAttendance")}>Mark these punches as no work</button><p className="mt-1 text-xs">Use only when the recorded punches are incorrect. For a scheduled day without punches, check uploads and review the day status in attendance details.</p></details>
    </>}
    {state.preview && !state.approved && <div ref={previewRef} tabIndex={-1} className="space-y-3 rounded-xl border border-blue-400 p-4 focus:ring-2 focus:ring-blue-500"><h3 className="font-semibold">Confirm this correction</h3><p className="text-sm">{employee?.name} · {formatWorkday(day)} · {state.draft?.changes.length} change(s)</p><div className="text-sm"><strong>Proposed sequence · preview</strong>{state.preview.plans.flatMap(plan => plan.records).filter(record => record.status === "VALID" && !record.excluded).map(record => <p key={record.id}>{record.type} · {originalPunchDateTime(record.at)}</p>)}</div><ul className="list-inside list-disc text-sm">{[...new Set(state.preview.plans.flatMap(plan => plan.warnings))].map(warning => <li key={warning}>{warning}</li>)}</ul><p className="text-sm">Confirming approves the exact values and accepts these warnings. Notes are optional. Phone attendance stays unchanged.</p><button className={primary} disabled={busy} onClick={() => void approve()}>{busy ? "Checking and saving…" : "Confirm correction"}</button></div>}
    {state.approved && !estimated && <button className={primary} disabled={busy} onClick={() => void approve()}>{busy ? "Updating…" : "Check status and update estimate"}</button>}
    {state.approved && estimated && <button className={button} onClick={() => { retain({ requestId: generateUUID(), draft: null, preview: null, approved: false }); setAddPunch(false); setEstimated(false); setNotice(""); void payrollRead<WorkEmployee>("employee", { periodId: period.id, employeeId }).then(setEmployee).catch(() => setError("Reload the employee before another correction.")); }}>Make another correction</button>}
    <Link className="inline-flex min-h-11 items-center text-sm underline" href={reviewHref}>Batch changes and history</Link>
    {attendanceDetailsHref && <p><Link className="inline-flex min-h-11 items-center text-sm underline" href={attendanceDetailsHref}>View attendance totals, day status and overtime</Link><span className="block text-xs text-muted-foreground">Select {formatWorkday(day)} in this employee’s attendance details. Return here with your browser’s Back button.</span></p>}
  </section>;
}
