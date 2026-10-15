"use client";

import { useEffect, useRef, useState } from "react";
import { cancelScheduleOperationRequest, getScheduleDayHistory, getScheduleDayOperations, getScheduleRequestReceipt, submitScheduleDayOperation } from "@/app/actions/scheduleWorkspaceAction";
import { applyScheduleChanges, retainRestDesignation } from "@/lib/scheduling/model";
import { describeSchedule } from "@/lib/scheduling/presentation";
import type { ScheduleDayHistoryPage, ScheduleDayOperationCommand, ScheduleDayOperations, ScheduleOperationKind, ScheduleReceipt, ScheduleSnapshot } from "@/lib/scheduling/workspace-types";
import { formatWorkday } from "@/lib/payroll/dateDisplay";
import { generateUUID } from "@/lib/uuid";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const button = `inline-flex min-h-11 items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;
const input = `min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base ${focus}`;
const operationLabels: Record<ScheduleOperationKind, string> = { adjust: "Adjust this day", cover: "Arrange cover", swap: "Swap schedules" };
const stamp = (value: string) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

export function ScheduleSnapshotDetails({ snapshot }: { snapshot: ScheduleSnapshot }) {
  if (snapshot.kind !== "shift") return <p>{snapshot.kind === "rest" ? "Rest day" : "Schedule unconfigured"}</p>;
  const presentation = describeSchedule(snapshot);
  return <div className="space-y-1 break-words text-sm">
    <p className="font-medium">{presentation.periodsLabel}</p>
    <p>{snapshot.shiftName}</p>
    {snapshot.designatedRestDay && <p className="font-medium text-amber-800 dark:text-amber-300">Designated rest day retained for review and applicable treatment.</p>}
    {!!presentation.details.length && <ul className="list-disc space-y-1 pl-5">{presentation.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>}
    {!!presentation.warnings.length && <ul className="list-disc space-y-1 pl-5 text-amber-800 dark:text-amber-300">{presentation.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
  </div>;
}

function ChangePreview({ name, before, after, saved = false }: { name: string; before: ScheduleSnapshot; after: ScheduleSnapshot; saved?: boolean }) {
  return <section className="min-w-0 space-y-2 rounded-lg border p-3"><h5 className="font-semibold">{name}</h5><div className="grid min-w-0 gap-3 sm:grid-cols-2"><div><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{saved ? "Before" : "Current"}</p><ScheduleSnapshotDetails snapshot={before} /></div><div><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{saved ? "Saved" : "Proposed"}</p><ScheduleSnapshotDetails snapshot={after} /></div></div></section>;
}

export function ScheduleDayActions({ employeeId, employeeName, day, periodId, onSaved }: { employeeId: string; employeeName: string; day: string; periodId: string; onSaved: () => Promise<void> }) {
  const [panel, setPanel] = useState<ScheduleOperationKind | "history" | null>(null);
  const [context, setContext] = useState<ScheduleDayOperations | null>(null);
  const [history, setHistory] = useState<ScheduleDayHistoryPage | null>(null);
  const [selected, setSelected] = useState("");
  const [replacementId, setReplacementId] = useState("");
  const [custom, setCustom] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ScheduleReceipt | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [cancelRetryId, setCancelRetryId] = useState<string | null>(null);
  const command = useRef<ScheduleDayOperationCommand | null>(null);
  const pending = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (receipt) resultRef.current?.focus(); }, [receipt]);

  const candidate = context?.candidates.find(row => row.employeeId === replacementId);
  const operation = panel && panel !== "history" ? panel : null;
  let proposed: ScheduleSnapshot | null = null, previewError = "";
  if (context && selected && operation === "adjust") {
    try { proposed = retainRestDesignation(context.cell.snapshot, applyScheduleChanges([context.cell], [{ employeeId, day, value: selected, ...(custom ? { customTimes: { start, end } } : {}) }], new Map(context.shifts.map(shift => [String(shift.id), shift.snapshot])))[0].snapshot); }
    catch (cause) { previewError = cause instanceof Error ? cause.message : "Check the selected schedule and times."; }
  }
  const reviewReasons = [...(operation === "cover" ? [] : context?.reviewReasons ?? []), ...(operation !== "adjust" ? candidate?.reviewReasons ?? [] : [])];
  const replacementAfter = context && candidate ? retainRestDesignation(candidate.snapshot, context.cell.snapshot) : null;
  const primaryAfterSwap = context && candidate ? retainRestDesignation(context.cell.snapshot, candidate.snapshot) : null;
  const restWork = Boolean(operation === "adjust" && proposed?.kind === "shift" && proposed.designatedRestDay || operation !== "adjust" && operation && replacementAfter?.kind === "shift" && replacementAfter.designatedRestDay || operation === "swap" && primaryAfterSwap?.kind === "shift" && primaryAfterSwap.designatedRestDay);
  if (restWork) reviewReasons.push("This proposes work on a designated rest day. Payroll Admin must review the arrangement; rest-day treatment is retained.");
  const requiresReview = Boolean(operation !== "cover" && context?.reviewRequired || operation !== "adjust" && candidate?.requiresReview || restWork);
  const restrictions = [...(operation === "cover" ? [] : context?.restrictions ?? []), ...(operation !== "adjust" ? candidate?.restrictions ?? [] : [])];
  if (operation && operation !== "adjust" && context && context.cell.snapshot.kind !== "shift") restrictions.push("Start cover or a swap from the employee with a working shift. Use Change schedule to set this employee's day directly.");
  const disabled = busy || uncertain || refreshNeeded;

  function edited() { setReceipt(null); setError(""); command.current = null; }
  async function loadContext() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const next = await getScheduleDayOperations({ employeeId, day, periodId });
      setContext(next); setHistory(next.history);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This date's schedules could not load. Retry here."); }
    finally { pending.current = false; setBusy(false); }
  }
  function open(next: ScheduleOperationKind | "history") {
    setPanel(next);
    if (next !== "history" && next !== panel && !uncertain && !refreshNeeded) edited();
    if (!context && !pending.current) void loadContext();
  }
  async function refreshViews() {
    setRefreshNeeded(true); setError("");
    const [schedule, oversight] = await Promise.allSettled([getScheduleDayOperations({ employeeId, day, periodId }), onSaved()]);
    if (schedule.status === "fulfilled") { setContext(schedule.value); setHistory(schedule.value.history); }
    if (schedule.status === "fulfilled" && oversight.status === "fulfilled") setRefreshNeeded(false);
    else setError("Your action has a saved receipt. The current schedule or attendance view could not refresh. Retry these views without submitting again.");
  }
  async function complete(saved: ScheduleReceipt) {
    command.current = null; setUncertain(false); setReceipt(saved);
    await refreshViews();
  }
  async function save() {
    if (pending.current || refreshNeeded || !context || !operation) return;
    if (!command.current && (restrictions.length || previewError || operation === "adjust" && !proposed || operation !== "adjust" && !candidate)) return;
    pending.current = true; setBusy(true); setError("");
    const input: ScheduleDayOperationCommand = command.current ?? {
      requestId: generateUUID(), departmentId: context.departmentId, periodId: context.periodId,
      sourceDigest: context.sourceDigest, expectedDraftId: context.expectedDraftId, expectedDraftRevision: context.expectedDraftRevision,
      employeeId, day, operation, ...(operation === "adjust" ? { value: selected, ...(custom ? { customTimes: { start, end } } : {}) } : { replacementEmployeeId: replacementId }), ...(note.trim() ? { note: note.trim() } : {}),
    };
    try {
      if (command.current) { const saved = await getScheduleRequestReceipt(input.requestId); if (saved) { await complete(saved); return; } }
      command.current = input;
      const result = await submitScheduleDayOperation(input);
      if (result.ok) { await complete(result.receipt); return; }
      const saved = await getScheduleRequestReceipt(input.requestId);
      if (saved) { await complete(saved); return; }
      if (result.uncertain) { setUncertain(true); setError("The saved outcome is not confirmed yet. Check status and retry this same request; your entries and request reference are retained."); return; }
      command.current = null; setUncertain(false); setError(result.error);
    } catch {
      setUncertain(true);
      try {
        const saved = await getScheduleRequestReceipt(input.requestId);
        if (saved) await complete(saved);
        else setError("The response was interrupted. No receipt is available yet. Check status and retry this same request; your selection is retained.");
      } catch { setError("The response and receipt check were interrupted. Check status and retry the same request before making another change."); }
    } finally { pending.current = false; setBusy(false); }
  }
  async function retryViews() {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { await refreshViews(); } finally { pending.current = false; setBusy(false); }
  }
  async function olderHistory() {
    if (pending.current || !history?.nextCursor) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const older = await getScheduleDayHistory({ employeeId, day, periodId, cursor: history.nextCursor });
      setHistory({ ...older, requests: history.requests, entries: [...history.entries, ...older.entries] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Older history could not load. Retry without changing the schedule."); }
    finally { pending.current = false; setBusy(false); }
  }
  async function cancelRequest(requestId: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const result = await cancelScheduleOperationRequest({ requestId });
      if (!result.ok && result.uncertain) throw new Error("Cancellation outcome is not confirmed.");
      if (!result.ok) { setUncertain(false); setCancelRetryId(null); setError(result.error); return; }
      setCancelConfirmId(null); setCancelRetryId(null); await complete(result.receipt);
    } catch {
      try {
        const saved = await getScheduleRequestReceipt(requestId);
        if (saved && saved.outcome && ["cancelled", "approved", "denied"].includes(saved.outcome)) { setCancelConfirmId(null); setCancelRetryId(null); await complete(saved); return; }
      } catch { /* Keep the exact request for cancellation status recovery. */ }
      setUncertain(true); setCancelRetryId(requestId); setError("The cancellation response was interrupted. Check and retry cancellation of this same request before making another change.");
    } finally { pending.current = false; setBusy(false); }
  }

  return <section className="space-y-3 rounded-xl border border-blue-200 p-3 dark:border-blue-900" aria-label={`Schedule tools for ${employeeName}, ${day}`}>
    <h3 className="font-semibold">Schedule and change history</h3>
    <div className="flex flex-wrap gap-2">{(["adjust", "cover", "swap", "history"] as const).map(item => <button type="button" className={button} aria-pressed={panel === item} disabled={busy || uncertain && panel !== item} key={item} onClick={() => open(item)}>{item === "adjust" ? "Change schedule" : item === "history" ? "View history" : operationLabels[item]}</button>)}</div>
    {panel && <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{panel === "history" ? "Schedule history" : operationLabels[panel]} · {formatWorkday(day)}</h4><button type="button" className={button} disabled={busy || uncertain} onClick={() => setPanel(null)}>Close tools</button></div>
      {busy && !context && <p role="status">Loading this date's schedules and history…</p>}
      {context && panel !== "history" && <>
        <p className="text-sm">{employeeName} · This date only. Weekly defaults, original punches and other draft dates remain separate.</p>
        {context.pendingDraftCell && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">A saved period draft already includes this day: {context.pendingDraftCell.label}. Your explicit choice below will be reviewed; other draft dates stay saved.</p>}
        {panel === "adjust" ? <fieldset disabled={disabled} className="space-y-3">
          <label className="block space-y-1 text-sm font-medium">Schedule<select name="schedule" className={input} value={selected} onChange={event => { edited(); setSelected(event.target.value); if (["rest", "unconfigured"].includes(event.target.value)) setCustom(false); }}><option value="">Choose a schedule</option>{context.cell.snapshot.kind === "shift" && <option value="captured">Current schedule</option>}<option value="rest">Rest day</option><option value="unconfigured">Unconfigured</option><option value="default">Restore captured period default</option><option value="latest-default">Use latest weekly default</option>{context.shifts.map(shift => <option value={shift.id} key={shift.id}>{shift.label}</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className={focus} checked={custom} disabled={["rest", "unconfigured"].includes(selected)} onChange={event => { edited(); setCustom(event.target.checked); if (event.target.checked) { const base = context.shifts.find(shift => String(shift.id) === selected)?.snapshot ?? context.cell.snapshot; setStart(base.checkInTime?.slice(0, 5) ?? ""); setEnd(base.checkOutTime?.slice(0, 5) ?? ""); if (!selected) setSelected("captured"); } }} />Adjust start/end for this date</label>
          {custom && <><div className="grid min-w-0 grid-cols-2 gap-3"><label className="min-w-0 space-y-1 text-sm font-medium">Start<input name="start" type="time" className={input} value={start} onChange={event => { edited(); setStart(event.target.value); }} /></label><label className="min-w-0 space-y-1 text-sm font-medium">End<input name="end" type="time" className={input} value={end} onChange={event => { edited(); setEnd(event.target.value); }} /></label></div><p className="text-sm text-muted-foreground">Existing template breaks are retained. An earlier end finishes the next day. Choose another shift to change its breaks.</p></>}
        </fieldset> : <fieldset disabled={disabled} className="space-y-3">
          <p className="text-sm">{panel === "cover" ? "Assign this shift to another employee in this branch. The unavailable employee's schedule, absence and leave review stay unchanged." : "Exchange both employees' schedules for this date. Both changes save together or neither saves."}</p>
          <label className="block space-y-1 text-sm font-medium">{panel === "cover" ? "Replacement employee" : "Swap with"}<select name="replacementEmployeeId" className={input} value={replacementId} onChange={event => { edited(); setReplacementId(event.target.value); }}><option value="">Choose an employee in this branch</option>{context.candidates.map(row => <option value={row.employeeId} key={row.employeeId}>{row.name} · {row.employeeNo} · {row.label}{row.restrictions.length ? " · Check conflict" : row.requiresReview ? " · Review needed" : ""}</option>)}</select></label>
          {!context.candidates.length && <p>No other eligible employees are available in this branch for this date.</p>}
        </fieldset>}
        {previewError && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{previewError}</p>}
        <div className="space-y-2" aria-label="Review schedule changes">
          {panel === "adjust" && proposed && <ChangePreview name={employeeName} before={context.cell.snapshot} after={proposed} />}
          {panel !== "adjust" && candidate && replacementAfter && primaryAfterSwap && <><ChangePreview name={employeeName} before={context.cell.snapshot} after={panel === "cover" ? context.cell.snapshot : primaryAfterSwap} /><ChangePreview name={candidate.name} before={candidate.snapshot} after={replacementAfter} />{panel === "cover" && <p className="text-sm">Coverage does not resolve the original employee's absence or leave finding.</p>}</>}
        </div>
        {!!restrictions.length && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950"><p className="font-semibold">This change cannot be saved</p><ul className="list-disc pl-5">{[...new Set(restrictions)].map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
        {requiresReview && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Payroll Admin review required for this change</p><ul className="list-disc pl-5">{[...new Set(reviewReasons)].map(reason => <li key={reason}>{reason}</li>)}</ul><p className="mt-2">Submitting saves a pending request. It does not change the active schedule or clear attendance findings.</p></div>}
        <label className="block space-y-1 text-sm font-medium">Note (optional)<textarea name="note" className={`${input} min-h-20 py-2`} rows={2} maxLength={500} value={note} disabled={disabled} onChange={event => { edited(); setNote(event.target.value); }} placeholder="Context for this change…" /></label>
        <p className="text-xs text-muted-foreground">Saving records who changed what and when. Applied changes refresh attendance inputs; final payroll remains with Payroll Admin.</p>
        <div className="flex flex-wrap gap-2"><button type="button" className={`${button} bg-blue-700 text-white hover:bg-blue-800`} disabled={busy || refreshNeeded || !!receipt || !!cancelRetryId || !uncertain && (!!restrictions.length || !!previewError || panel === "adjust" && !proposed || panel !== "adjust" && !candidate)} onClick={() => void save()}>{busy ? "Saving or checking status…" : uncertain ? "Check status and retry same request" : requiresReview ? "Submit for Admin review" : panel === "swap" ? "Confirm both schedules" : panel === "cover" ? "Confirm coverage" : "Confirm this date's schedule"}</button><button type="button" className={button} disabled={busy || uncertain || refreshNeeded} onClick={() => void loadContext()}>Reload current schedules</button></div>
      </>}
      {panel === "history" && history && <>
        <p className="text-sm text-muted-foreground">Work date {formatWorkday(day)}. Saved timestamps are Philippine time. Reversals create another entry.</p>
        {!!history.requests.length && <section className="space-y-2"><h5 className="font-semibold">Recent review requests (up to 20)</h5>{history.requests.map(request => <div key={request.id} className="space-y-2 rounded-lg border p-3 text-sm"><p className="font-medium">{operationLabels[request.operation]} · {request.status}</p><p>Submitted {stamp(request.createdAt)}{request.decidedAt ? ` · Updated ${stamp(request.decidedAt)}` : ""}</p>{request.status === "Pending" && <p>Active schedules remain unchanged while this request awaits review.</p>}{!!request.reasons.length && <ul className="list-disc pl-5">{request.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}<p className="mt-1 break-all text-xs text-muted-foreground">Reference {request.id}</p>{request.canCancel && request.status === "Pending" && (cancelConfirmId === request.id ? <div className="space-y-2"><p>Cancel your pending request? The active schedules stay unchanged.</p><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || uncertain} onClick={() => void cancelRequest(request.id)}>Confirm cancellation</button><button type="button" className={button} disabled={busy || uncertain} onClick={() => setCancelConfirmId(null)}>Keep request</button></div></div> : <button type="button" className={button} disabled={busy || uncertain} onClick={() => setCancelConfirmId(request.id)}>Cancel my request</button>)}</div>)}</section>}
        {!history.entries.length ? <p className="text-sm">No saved schedule revisions for this employee and date.</p> : <ol className="space-y-3">{history.entries.map(entry => <li key={entry.id} className="space-y-2 rounded-lg border p-3"><p className="font-semibold">{operationLabels[entry.operation]} · {stamp(entry.createdAt)}</p><p className="text-sm">{entry.actorName} · {entry.actorRole}</p><ChangePreview name={employeeName} before={entry.before} after={entry.after} saved />{entry.note && <p className="break-words text-sm">Your note: {entry.note}</p>}<p className="break-all text-xs text-muted-foreground">Operation {entry.requestId}{entry.linkedEmployees.length > 1 ? ` · ${entry.linkedEmployees.length} linked employee dates` : ""}</p></li>)}</ol>}
        {history.nextCursor && <button type="button" className={button} disabled={busy} onClick={() => void olderHistory()}>{busy ? "Loading…" : "Load older changes"}</button>}
        <button type="button" className={button} disabled={busy || uncertain} onClick={() => void (refreshNeeded ? retryViews() : loadContext())}>Refresh history</button>
      </>}
      {receipt && <div ref={resultRef} tabIndex={-1} role="status" className={`space-y-2 rounded-lg border p-3 text-sm ${receipt.outcome === "pending-review" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-green-300 bg-green-50 text-green-950"}`}><p className="font-semibold">{receipt.outcome === "pending-review" ? "Request saved — awaiting Payroll Admin" : receipt.outcome === "denied" ? "Request denied" : receipt.outcome === "cancelled" ? "Request cancelled" : "Schedule change saved"}</p><p>{receipt.message}</p><p className="break-all text-xs">Reference {receipt.reviewRequestId ?? receipt.requestId}</p><button type="button" className={button} disabled={busy} onClick={() => open("history")}>View this date's history</button></div>}
      {error && <div className="space-y-2 rounded-lg border border-red-400 bg-red-50 p-3 text-sm text-red-950"><p ref={errorRef} tabIndex={-1} role="alert">{error}</p><p>Your entries are retained.</p>{cancelRetryId ? <button type="button" className={button} disabled={busy} onClick={() => void cancelRequest(cancelRetryId)}>Check status and retry cancellation</button> : refreshNeeded ? <button type="button" className={button} disabled={busy} onClick={() => void retryViews()}>Refresh views</button> : !context && <button type="button" className={button} disabled={busy} onClick={() => void loadContext()}>Retry loading this date</button>}</div>}
    </div>}
  </section>;
}
