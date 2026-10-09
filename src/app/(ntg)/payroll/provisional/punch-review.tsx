"use client";

import { useRef } from "react";
import { canCorrectRecord, type WorkBoard, type WorkChange, type WorkDraft, type WorkEmployee, type WorkKind, type WorkRecord } from "@/lib/payroll/attendanceWorkbenchModel";
import { originalPunchDateTime } from "@/lib/payroll/attendanceResolutionModel";
import { changesForPunch } from "@/lib/payroll/provisionalPunchEdits";
import { ChangeRow, changeLabels } from "../attendance-source/batch-review";

type Props = {
  board: WorkBoard; employee: WorkEmployee; day: string; draft: WorkDraft | null; busy: boolean;
  onAdd: (kind: WorkKind, record: WorkRecord) => void;
  editChange: (employeeId: string, id: string, patch: Partial<WorkChange>) => void;
  onRemove: (ids: string[]) => void;
};
const grid = "grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,.85fr)]";

function actionLabel(changes: WorkChange[]): string {
  if (changes.length > 1) return `${changes.length} pending changes`;
  const change = changes[0];
  if (!change) return "Change this punch…";
  switch (change.kind) {
    case "Direction": return change.type ? `Changed to ${change.type}` : "Select direction";
    case "Time": return change.at ? "Date/time changed" : "Enter actual time";
    case "Void": return "Void selected";
    case "Restore": return "Restore selected";
    case "Exclude": return "Exclude from DTR selected";
    case "Retain": return "Retain in DTR selected";
    default: return changeLabels[change.kind];
  }
}

function PunchRow({ record, ...props }: Props & { record: WorkRecord }) {
  const { board, employee, day, draft, onAdd, editChange, onRemove } = props;
  const action = useRef<HTMLSelectElement>(null);
  const changes = changesForPunch(draft, record, day);
  const input = employee.days.find(value => value.day === day)?.attendance?.punches.find(punch => punch.id === record.id);
  const originalChanged = (record.originalAt && record.originalAt !== record.at) || (record.originalType && record.originalType !== record.type);
  function undo(ids: string[]) { onRemove(ids); action.current?.focus(); }
  return <li aria-label={`Saved punch ${record.type} ${originalPunchDateTime(record.at)}`} className={`${grid} border-t p-3 ${changes.length ? "border-l-2 border-l-blue-600 bg-blue-50 dark:bg-blue-950/30" : ""}`}>
    <div className="min-w-0 space-y-1 break-words">
      <p className="text-xs text-muted-foreground lg:hidden">Saved punch</p>
      <p className="font-semibold">{record.type} · {originalPunchDateTime(record.at)}</p>
      {input ? <p className={`text-xs ${input.included ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300"}`}>{input.included ? "Included in attendance calculation" : `Not counted · ${input.reason || "Review required"}`}</p> : <p className="text-xs text-muted-foreground">{record.status === "VOID" ? "VOID" : record.excluded ? "Excluded from DTR" : ""}</p>}
      {originalChanged && <p className="text-xs">Original capture: {record.originalType || record.type} · {originalPunchDateTime(record.originalAt || record.at)}</p>}
    </div>
    <div className="min-w-0 space-y-2">
      <p className="text-xs text-muted-foreground lg:hidden">Proposed change</p>
      {changes.length && draft ? <><p className="text-xs font-semibold text-blue-800 dark:text-blue-200">Pending · Not applied</p>{changes.map(change => <ChangeRow key={change.id} change={change} draft={draft} employee={employee} board={board} editChange={editChange} remove={() => undo([change.id])} inline />)}</> : <p className="text-xs text-muted-foreground">No change</p>}
    </div>
    <div className="flex min-w-0 items-start gap-2 lg:flex-col">
      <select ref={action} aria-label={`Change ${record.type} ${originalPunchDateTime(record.at)}`} className="min-h-11 w-full min-w-0 rounded-lg border bg-background p-2 text-sm" value="summary" onChange={event => { if (event.target.value !== "summary") onAdd(event.target.value as WorkKind, record); }}>
        <option value="summary">{actionLabel(changes)}</option>
        {(["Direction", "Time", "Void", "Restore", "Exclude", "Retain"] as WorkKind[]).filter(kind => canCorrectRecord(record, kind)).map(kind => <option key={kind} value={kind}>{changeLabels[kind]}</option>)}
      </select>
      {changes.length > 1 && <button type="button" className="min-h-11 shrink-0 rounded-lg px-2 py-2 text-sm font-semibold text-blue-800 focus-visible:ring-2 dark:text-blue-200" onClick={() => undo(changes.map(change => change.id))}>Undo all</button>}
    </div>
  </li>;
}

export function PunchReview(props: Props) {
  const currentDay = props.employee.days.find(value => value.day === props.day);
  if (!currentDay) return null;
  const count = props.draft?.changes.length ?? 0;
  return <fieldset disabled={props.busy} className="min-w-0 rounded-lg border text-sm" aria-label="Saved punches and pending changes">
    <div className="space-y-1 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong>Review punches</strong><span className="text-xs font-semibold" role="status">{count ? `${count} pending ${count === 1 ? "change" : "changes"}` : "No pending changes"}</span></div><p>Schedule: {currentDay.rest ? "Rest day" : currentDay.schedule?.checkInTime ? `${currentDay.schedule.checkInTime}–${currentDay.schedule.checkOutTime}` : "Unconfigured"}</p><p className="text-xs text-muted-foreground">Philippine time · Seconds shown · Original captures retained</p></div>
    <div aria-hidden="true" className={`${grid} hidden px-3 pb-2 text-xs text-muted-foreground lg:grid`}><span>Saved punch</span><span>Proposed change</span><span>Action</span></div>
    <ul>{currentDay.records.map(record => <PunchRow key={record.id} {...props} record={record} />)}</ul>
    {!currentDay.records.length && <p className="p-3">No work recorded. A correction is optional.</p>}
  </fieldset>;
}
