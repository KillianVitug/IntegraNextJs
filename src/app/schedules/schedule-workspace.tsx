"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { archiveWeeklyDefault, confirmScheduleDraft, deleteScheduleDraft, getScheduleRequestReceipt, getScheduleWorkspace, saveScheduleDraft, saveWeeklyDefaults } from "@/app/actions/scheduleWorkspaceAction";
import type { ScheduleActionResult, ScheduleArchiveCommand, SchedulePeriodCommand, ScheduleReceipt, ScheduleWeeklyCommand, ScheduleWorkspace } from "@/lib/scheduling/workspace-types";
import { generateUUID } from "@/lib/uuid";
import { PeriodSchedule } from "./period-schedule";
import { WeeklyDefaults } from "./weekly-defaults";
import { Field, inputClass, ScheduleButton, ScheduleNotice } from "./schedule-ui";

type Props = { initialWorkspace: ScheduleWorkspace; initialView: "weekly" | "period"; employeeId?: string; day?: string; payrollGroup?: "Daily" | "Monthly"; canViewPayroll?: boolean };
type PendingAction = { requestId: string; title: string; effectiveDate?: string; run: () => Promise<ScheduleActionResult> };

export function ScheduleWorkspaceEditor({ initialWorkspace, initialView, employeeId, day, payrollGroup = "Daily", canViewPayroll = false }: Props) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [weeklyWorkspace, setWeeklyWorkspace] = useState(initialWorkspace);
  const [periodWorkspace, setPeriodWorkspace] = useState(initialWorkspace);
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState({ weekly: false, period: false });
  const [editorVersion, setEditorVersion] = useState({ weekly: 0, period: 0 });
  const [scope, setScope] = useState({ departmentId: workspace.departmentId?.toString() ?? "", periodId: workspace.periodId ?? "", effectiveDate: workspace.effectiveDate });
  const pending = useRef<PendingAction | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const anyDirty = dirty.weekly || dirty.period;
  const locked = busy || unknown;

  useEffect(() => {
    if (!error) return;
    errorRef.current?.focus();
    errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);
  useEffect(() => {
    if (!anyDirty && !unknown) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [anyDirty, unknown]);

  function updateUrl(next: typeof scope, nextView = view) {
    const query = new URLSearchParams();
    if (next.departmentId) query.set("departmentId", next.departmentId);
    if (next.periodId) query.set("periodId", next.periodId);
    if (next.effectiveDate) query.set("effectiveDate", next.effectiveDate);
    if (employeeId) query.set("employeeId", employeeId);
    if (day) query.set("day", day);
    query.set("view", nextView);
    query.set("group", payrollGroup);
    window.history.replaceState(null, "", `/schedules?${query}`);
  }

  async function refreshModel(savedView?: "weekly" | "period", effectiveDate?: string) {
    const model = await getScheduleWorkspace({ departmentId: workspace.departmentId ?? undefined, periodId: workspace.periodId ?? undefined, effectiveDate: effectiveDate ?? workspace.effectiveDate });
    setWorkspace(model);
    const nextScope = { departmentId: model.departmentId?.toString() ?? "", periodId: model.periodId ?? "", effectiveDate: model.effectiveDate };
    setScope(nextScope); updateUrl(nextScope);
    const refreshWeekly = !savedView || savedView === "weekly" || !dirty.weekly;
    const refreshPeriod = !savedView || savedView === "period" || !dirty.period;
    if (refreshWeekly) setWeeklyWorkspace(model);
    if (refreshPeriod) setPeriodWorkspace(model);
    setEditorVersion(value => ({ weekly: value.weekly + Number(refreshWeekly), period: value.period + Number(refreshPeriod) }));
    setDirty(previous => ({ weekly: refreshWeekly ? false : previous.weekly, period: refreshPeriod ? false : previous.period }));
  }
  async function completed(receipt: ScheduleReceipt) {
    const effectiveDate = pending.current?.effectiveDate;
    pending.current = null; setUnknown(false); setNotice(`${receipt.message} Receipt: ${receipt.requestId}`); setError("");
    const savedView = receipt.action === "weekly_saved" || receipt.action === "weekly_archived" ? "weekly" : "period";
    try { await refreshModel(savedView, effectiveDate); } catch { setError("The change was saved, but the updated schedule could not load. Reload the saved schedule below; do not submit the change again."); setDirty(previous => ({ ...previous, [savedView]: false })); }
  }
  async function checkReceipt() {
    if (!pending.current) return;
    setBusy(true); setError("");
    try {
      const receipt = await getScheduleRequestReceipt(pending.current.requestId);
      if (receipt) await completed(receipt);
      else setError("No completed receipt is available yet. Your inputs are retained. Retry the same request safely, or check its status again.");
    } catch { setError("The request status could not be reached. Your inputs are retained; check again when the connection returns."); }
    finally { setBusy(false); }
  }
  async function execute(action: PendingAction, retry = false) {
    if (pending.current && !retry) { setError("Check or retry the pending request before starting another action."); return; }
    pending.current = action; setBusy(true); setError(""); setNotice("");
    try {
      if (retry) {
        const receipt = await getScheduleRequestReceipt(action.requestId);
        if (receipt) { await completed(receipt); return; }
      }
      const result = await action.run();
      if (!result.ok) {
        const receipt = await getScheduleRequestReceipt(action.requestId);
        if (receipt) { await completed(receipt); return; }
        pending.current = null; setUnknown(false); setError(result.error); return;
      }
      await completed(result.receipt);
    } catch {
      setUnknown(true);
      try {
        const receipt = await getScheduleRequestReceipt(action.requestId);
        if (receipt) await completed(receipt);
        else setError(`${action.title} did not return a completion receipt. Inputs are retained. Check status or retry the same request.`);
      } catch { setError(`${action.title} was interrupted and its status could not be checked. Inputs are retained. Check status before retrying.`); }
    } finally { setBusy(false); }
  }
  async function changeScope() {
    if (anyDirty || unknown) { setError("Save your edits or discard the local edits before changing branch, period or default date. Your current inputs are retained."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const model = await getScheduleWorkspace({ departmentId: scope.departmentId ? Number(scope.departmentId) : undefined, periodId: scope.periodId || undefined, effectiveDate: scope.effectiveDate || undefined });
      setWorkspace(model); setWeeklyWorkspace(model); setPeriodWorkspace(model); setScope({ departmentId: model.departmentId?.toString() ?? "", periodId: model.periodId ?? "", effectiveDate: model.effectiveDate }); setEditorVersion(value => ({ weekly: value.weekly + 1, period: value.period + 1 })); updateUrl(scope);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Schedules could not load. Your current view is retained."); }
    finally { setBusy(false); }
  }
  async function periodAction(action: "save" | "confirm" | "delete", changes: SchedulePeriodCommand["changes"]) {
    if (workspace.departmentId === null || !workspace.periodId) return;
    const command: SchedulePeriodCommand = { requestId: generateUUID(), departmentId: workspace.departmentId, periodId: workspace.periodId, sourceDigest: periodWorkspace.draft?.sourceDigest ?? periodWorkspace.sourceDigest, expectedDraftId: periodWorkspace.draft?.id ?? null, expectedDraftRevision: periodWorkspace.draft?.revision ?? null, changes };
    const title = action === "save" ? "Save draft" : action === "confirm" ? "Confirm schedule" : "Delete draft";
    const run = action === "save" ? saveScheduleDraft : action === "confirm" ? confirmScheduleDraft : deleteScheduleDraft;
    await execute({ requestId: command.requestId, title, run: () => run(command) });
  }
  async function saveWeekly(value: Pick<ScheduleWeeklyCommand, "effectiveFrom" | "effectiveTo" | "employeeIds" | "days">) {
    if (workspace.departmentId === null) return;
    if (value.effectiveFrom !== weeklyWorkspace.effectiveDate) { setError("Review the effective date before saving these weekly defaults. Your selections and edits are retained."); return; }
    const command: ScheduleWeeklyCommand = { ...value, requestId: generateUUID(), departmentId: workspace.departmentId, sourceDigest: weeklyWorkspace.weeklyDigest };
    await execute({ requestId: command.requestId, title: "Save weekly defaults", effectiveDate: command.effectiveFrom, run: () => saveWeeklyDefaults(command) });
  }
  async function reviewWeeklyDate(effectiveDate: string) {
    if (locked) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const model = await getScheduleWorkspace({ departmentId: workspace.departmentId ?? undefined, periodId: workspace.periodId ?? undefined, effectiveDate });
      setWorkspace(model); setWeeklyWorkspace(model);
      const nextScope = { departmentId: model.departmentId?.toString() ?? "", periodId: model.periodId ?? "", effectiveDate: model.effectiveDate };
      setScope(nextScope); updateUrl(nextScope);
      setNotice("Current weekly defaults have been refreshed for the effective date. Your selected employees and weekday edits are retained; review them before saving.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Defaults for the effective date could not load. Your selections and edits are retained."); }
    finally { setBusy(false); }
  }
  async function archiveWeekly(value: Pick<ScheduleArchiveCommand, "employeeId" | "patternId" | "endDate">) {
    if (workspace.departmentId === null) return;
    const command: ScheduleArchiveCommand = { ...value, requestId: generateUUID(), departmentId: workspace.departmentId, sourceDigest: weeklyWorkspace.weeklyDigest };
    await execute({ requestId: command.requestId, title: "Save weekly end date", run: () => archiveWeeklyDefault(command) });
  }

  return <div className="min-w-0 space-y-4 pb-8" aria-busy={busy}>
    {canViewPayroll&&workspace.periodId&&<Link className="inline-flex min-h-11 items-center rounded border px-3 text-sm font-semibold" href={`/payroll/provisional?${new URLSearchParams({periodId:workspace.periodId,group:payrollGroup,...(employeeId?{employeeId}:{}),...(day?{day}:{}),...(workspace.departmentId?{departmentId:String(workspace.departmentId)}:{})})}`}>Estimate payroll for this period</Link>}
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h1 className="text-2xl font-semibold tracking-tight">Schedules</h1><p className="mt-1 text-sm text-muted-foreground">Set the normal week. Review its dates for payroll.</p></div><div className="text-sm text-muted-foreground" aria-live="polite">{busy ? `${pending.current?.title ?? "Loading schedules"}…` : ""}</div></div>
    <div className="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
      <Field label="Branch"><select className={inputClass} value={scope.departmentId} disabled={locked} onChange={event => setScope(previous => ({ ...previous, departmentId: event.target.value }))}>{!workspace.departments.length && <option value="">No assigned branches</option>}{workspace.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select></Field>
      <Field label="Payroll period"><select className={inputClass} value={scope.periodId} disabled={locked} onChange={event => setScope(previous => ({ ...previous, periodId: event.target.value }))}>{!workspace.periods.length && <option value="">No payroll periods</option>}{workspace.periods.map(period => <option key={period.id} value={period.id}>{period.code} · {period.startDate} – {period.endDate}</option>)}</select></Field>
      <Field label="View defaults as of"><input type="date" className={inputClass} value={scope.effectiveDate} disabled={locked} onChange={event => setScope(previous => ({ ...previous, effectiveDate: event.target.value }))} /></Field>
      <ScheduleButton className="self-end" disabled={locked} onClick={changeScope}>Open schedule</ScheduleButton>
    </div>
    <div className="flex flex-wrap gap-2 border-b pb-3" role="tablist" aria-label="Schedule views" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextView = event.key === "Home" ? "weekly" : event.key === "End" ? "period" : view === "weekly" ? "period" : "weekly";
      setView(nextView); updateUrl({ departmentId: workspace.departmentId?.toString() ?? "", periodId: workspace.periodId ?? "", effectiveDate: workspace.effectiveDate }, nextView);
      document.getElementById(`${nextView}-tab`)?.focus();
    }}><ScheduleButton role="tab" tabIndex={view === "weekly" ? 0 : -1} id="weekly-tab" aria-controls="weekly-panel" aria-selected={view === "weekly"} primary={view === "weekly"} onClick={() => { setView("weekly"); updateUrl({ departmentId: workspace.departmentId?.toString() ?? "", periodId: workspace.periodId ?? "", effectiveDate: workspace.effectiveDate }, "weekly"); }}>Weekly defaults</ScheduleButton><ScheduleButton role="tab" tabIndex={view === "period" ? 0 : -1} id="period-tab" aria-controls="period-panel" aria-selected={view === "period"} primary={view === "period"} onClick={() => { setView("period"); updateUrl({ departmentId: workspace.departmentId?.toString() ?? "", periodId: workspace.periodId ?? "", effectiveDate: workspace.effectiveDate }, "period"); }}>Period schedule</ScheduleButton></div>
    {notice && <div role="status" className="break-words rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">{notice}</div>}
    {error && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg focus:outline-none focus:ring-2 focus:ring-destructive"><ScheduleNotice error>{error}</ScheduleNotice><div className="mt-2 flex flex-wrap gap-2">{unknown ? <><ScheduleButton disabled={busy} onClick={checkReceipt}>Check request status</ScheduleButton><ScheduleButton disabled={busy} onClick={() => pending.current && execute(pending.current, true)}>Retry same request</ScheduleButton></> : <ScheduleButton disabled={busy} onClick={async () => { setBusy(true); try { await refreshModel(); setError(""); } catch { setError("The saved schedule could not load. Please try again."); } finally { setBusy(false); } }}>{anyDirty ? "Discard edits and reload saved schedule" : "Reload saved schedule"}</ScheduleButton>}</div></div>}
    {anyDirty && !unknown && <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"><span>Unsaved edits are retained while switching tabs, weeks and search filters.</span><ScheduleButton disabled={busy} onClick={() => { setWeeklyWorkspace(workspace); setPeriodWorkspace(workspace); setEditorVersion(value => ({ weekly: value.weekly + 1, period: value.period + 1 })); setDirty({ weekly: false, period: false }); setError(""); }}>Discard local edits</ScheduleButton></div>}
    <div role="tabpanel" id="weekly-panel" aria-labelledby="weekly-tab" hidden={view !== "weekly"}><WeeklyDefaults key={`weekly:${editorVersion.weekly}`} workspace={weeklyWorkspace} employeeId={employeeId} busy={locked} onDirty={value => setDirty(previous => ({ ...previous, weekly: value }))} onReviewDate={reviewWeeklyDate} onSave={saveWeekly} onArchive={archiveWeekly} /></div>
    <div role="tabpanel" id="period-panel" aria-labelledby="period-tab" hidden={view !== "period"}><PeriodSchedule key={`period:${editorVersion.period}`} workspace={periodWorkspace} employeeId={employeeId} day={day} busy={locked} onDirty={value => setDirty(previous => ({ ...previous, period: value }))} onAction={periodAction} /></div>
    {!workspace.departments.length && <ScheduleNotice>No branches are assigned to your account. An administrator can assign your branch access.</ScheduleNotice>}
    <p className="text-xs text-muted-foreground">Schedules describe planned work. Attendance and payroll approval remain separate.</p>
    <ScheduleButton className="sr-only focus:not-sr-only" onClick={() => router.refresh()}>Reload schedule page</ScheduleButton>
  </div>;
}
