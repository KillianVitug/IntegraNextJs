"use client";

import { useMemo, useState } from "react";
import { applyScheduleChanges, sameSchedule, scheduleLabel } from "@/lib/scheduling/model";
import type { ScheduleCell, SchedulePeriodCommand, ScheduleSnapshot, ScheduleWorkspace } from "@/lib/scheduling/workspace-types";
import { calendarDate, calendarWeeks, cellKey, Field, inputClass, manilaTimestamp, ScheduleButton, ScheduleNotice } from "./schedule-ui";

type Props = {
  workspace: ScheduleWorkspace;
  employeeId?: string;
  day?: string;
  busy: boolean;
  onDirty: (value: boolean) => void;
  onAction: (action: "save" | "confirm" | "delete", changes: SchedulePeriodCommand["changes"]) => Promise<void>;
};

function sourceLabel(source: string) {
  if (source === "LEGACY") return "Employee default schedule";
  if (source === "WEEKLY_PATTERN") return "Weekly default";
  if (source === "OVERRIDE") return "Dated exception";
  return source;
}

function SnapshotDetails({ snapshot }: { snapshot: ScheduleSnapshot }) {
  if (snapshot.kind !== "shift") return <span>{snapshot.kind === "rest" ? "Rest day" : "Unconfigured"}</span>;
  return <div className="space-y-1 break-words text-xs text-muted-foreground"><p>{snapshot.hoursPerDay} scheduled hours{snapshot.isFlexible ? " · Flexible" : ""} · {snapshot.graceMinutes} min grace</p><p>{snapshot.breakMinutes} min unpaid break · {snapshot.paidBreakMinutes} min paid break</p>{snapshot.breaks.length > 0 ? snapshot.breaks.map(item => <p key={item.slotKey}>{item.label}: {item.fromTime}–{item.toTime} · {item.deduct ? `deduct ${item.deductHours}h ${item.deductMinutes}m` : "paid"}</p>) : snapshot.breakMinutes + snapshot.paidBreakMinutes > 0 && <p>Break times are not configured.</p>}</div>;
}

export function PeriodSchedule({ workspace, employeeId, day, busy, onDirty, onAction }: Props) {
  const originalCells = workspace.draft?.cells ?? workspace.cells;
  const [values, setValues] = useState<Record<string, string>>({});
  const [prepared, setPrepared] = useState(Boolean(workspace.draft));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(workspace.employees.find(employee => employee.id === employeeId)?.name ?? "");
  const [bulkValue, setBulkValue] = useState("rest");
  const weeks = useMemo(() => calendarWeeks(workspace.dates), [workspace.dates]);
  const [week, setWeek] = useState(Math.max(0, weeks.findIndex(dates => day && dates.includes(day))));
  const dates = weeks[week] ?? [];
  const visibleEmployees = workspace.employees.filter(employee => `${employee.name} ${employee.employeeNo}`.toLowerCase().includes(search.toLowerCase()));
  const cells = new Map(originalCells.map(cell => [cellKey(cell.employeeId, cell.day), cell]));
  const changes = useMemo(() => originalCells.filter(cell => values[cellKey(cell.employeeId, cell.day)] !== undefined).map(cell => ({ employeeId: cell.employeeId, day: cell.day, value: values[cellKey(cell.employeeId, cell.day)] })), [originalCells, values]);
  const proposedCells = useMemo(() => applyScheduleChanges(originalCells, changes, new Map(workspace.shifts.map(shift => [String(shift.id), shift.snapshot]))), [originalCells, changes, workspace.shifts]);
  const proposedByKey = new Map(proposedCells.map(cell => [cellKey(cell.employeeId, cell.day), cell]));
  const period = workspace.periods.find(item => item.id === workspace.periodId);
  const visibleKeys = visibleEmployees.flatMap(employee => dates.map(date => cellKey(employee.id, date))).filter(key => cells.has(key));
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every(key => selected.has(key));
  const employeeNames = new Map(workspace.employees.map(employee => [employee.id, employee.name]));
  const isUnavailable = !workspace.periodId || !workspace.departmentId || !originalCells.length;

  const currentValue = (cell: ScheduleCell) => values[cellKey(cell.employeeId, cell.day)] ?? "saved";
  const label = (cell: ScheduleCell) => scheduleLabel(proposedByKey.get(cellKey(cell.employeeId, cell.day))?.snapshot ?? cell.snapshot);
  const bulkShift = workspace.shifts.find(shift => String(shift.id) === bulkValue);
  const reviewCells = proposedCells.filter(cell => !sameSchedule(cell.snapshot, cell.baselineSnapshot));
  const unconfigured = proposedCells.filter(cell => cell.snapshot.kind === "unconfigured").length;

  function setCellValues(keys: Iterable<string>, value: string) {
    const next = { ...values };
    for (const key of keys) if (cells.has(key)) next[key] = value;
    setValues(next); setPrepared(true); onDirty(true);
  }
  function toggle(keys: string[], checked: boolean) {
    setSelected(previous => {
      const next = new Set(previous);
      keys.filter(key => cells.has(key)).forEach(key => checked ? next.add(key) : next.delete(key));
      return next;
    });
  }

  return <section aria-label="Period schedule" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">{period?.code ?? "Choose a payroll period"}</h2><p className="text-sm text-muted-foreground">{period ? `${calendarDate(period.startDate)} – ${calendarDate(period.endDate)} · Philippine time` : "Choose a period above to prepare its schedule."}</p></div>
      <ScheduleButton primary disabled={busy || isUnavailable} onClick={() => { setPrepared(true); onDirty(true); }}>Apply weekly defaults</ScheduleButton>
    </div>
    <p className="text-sm text-muted-foreground">Apply prepares the whole branch for this period and preserves dated exceptions. Review the proposed schedule below, then confirm. Saved drafts do not affect payroll.</p>
    {workspace.draft && <ScheduleNotice>Saved draft · revision {workspace.draft.revision} · {manilaTimestamp(workspace.draft.updatedAt)}. All {originalCells.length} employee-days are included when you confirm.</ScheduleNotice>}
    {prepared && !workspace.draft && <ScheduleNotice>Prepared for review · {workspace.employees.length} employees · {originalCells.length} employee-days. Nothing has been confirmed yet.</ScheduleNotice>}
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/25 p-3">
      <div className="w-full sm:w-64"><Field label="Find employee"><input className={`${inputClass} w-full`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or employee number" type="search" /></Field></div>
      <div className="min-w-0 basis-full flex-1 sm:basis-0"><Field label={`Assign to ${selected.size} selected cells`}><select className={inputClass} value={bulkValue} onChange={event => setBulkValue(event.target.value)}><option value="rest">Rest day</option><option value="unconfigured">Unconfigured</option><option value="default">Restore period default</option><option value="latest-default">Use latest weekly default</option>{workspace.shifts.map(shift => <option key={shift.id} value={shift.id}>{scheduleLabel(shift.snapshot)}</option>)}</select></Field>{bulkShift && <p className="mt-1 break-words text-xs text-muted-foreground">{scheduleLabel(bulkShift.snapshot)}</p>}</div>
      <ScheduleButton disabled={!selected.size || busy} onClick={() => setCellValues(selected, bulkValue)}>Assign selected</ScheduleButton>
      {selected.size > 0 && <ScheduleButton onClick={() => setSelected(new Set())}>Clear selection</ScheduleButton>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm">{visibleEmployees.length} of {workspace.employees.length} employees · {selected.size} cells selected across all weeks and filters</span>
      <div className="flex items-center gap-2"><ScheduleButton aria-label="Previous schedule week" disabled={week <= 0} onClick={() => setWeek(value => value - 1)}>←</ScheduleButton><span className="text-sm font-medium">{weeks.length ? `${week + 1} / ${weeks.length}` : "0 / 0"}</span><ScheduleButton aria-label="Next schedule week" disabled={week >= weeks.length - 1} onClick={() => setWeek(value => value + 1)}>→</ScheduleButton></div>
    </div>
    <div className="max-w-full overflow-x-auto rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} role="region" aria-label="Schedule grid, scroll horizontally to see all dates">
      <table className="w-full min-w-[1000px] table-fixed border-collapse text-sm"><caption className="sr-only">Proposed period schedule. Select cells to assign a shift in bulk. Confirmation includes every employee and date in the selected branch and period.</caption><thead className="bg-muted"><tr><th className="sticky left-0 z-10 w-52 bg-muted p-3 text-left"><label className="flex min-h-10 items-center gap-2"><input type="checkbox" aria-label="Select all visible employee-day cells" checked={allVisibleSelected} onChange={event => toggle(visibleKeys, event.target.checked)} className="h-4 w-4" />Employee</label></th>{dates.map(date => <th key={date} className="border-l p-2 text-left"><label className="flex min-h-10 items-center gap-2"><input type="checkbox" aria-label={`Select ${calendarDate(date)}`} checked={visibleEmployees.length > 0 && visibleEmployees.every(employee => selected.has(cellKey(employee.id, date)))} onChange={event => toggle(visibleEmployees.map(employee => cellKey(employee.id, date)), event.target.checked)} className="h-4 w-4" />{calendarDate(date, true)}</label></th>)}</tr></thead><tbody>
        {visibleEmployees.map(employee => <tr key={employee.id} className="border-t"><th scope="row" className="sticky left-0 z-10 bg-background p-3 text-left align-top"><label className="flex min-h-10 items-start gap-2"><input type="checkbox" aria-label={`Select ${employee.name}, visible week`} checked={dates.length > 0 && dates.every(date => selected.has(cellKey(employee.id, date)))} onChange={event => toggle(dates.map(date => cellKey(employee.id, date)), event.target.checked)} className="mt-1 h-4 w-4 shrink-0" /><span className="min-w-0 break-words font-medium">{employee.name}<span className="block text-xs font-normal text-muted-foreground">{employee.employeeNo}</span></span></label></th>{dates.map(date => {
          const key = cellKey(employee.id, date), cell = cells.get(key);
          if (!cell) return <td key={date} className="border-l p-2">Outside scope</td>;
          const value = currentValue(cell), changed = !sameSchedule(proposedByKey.get(key)?.snapshot ?? cell.snapshot, cell.baselineSnapshot);
          return <td key={date} className={`border-l p-2 align-top ${selected.has(key) ? "bg-blue-50 dark:bg-blue-950/50" : ""}`}><label className="mb-1 flex min-h-7 items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" aria-label={`Select ${employee.name}, ${calendarDate(date)}`} checked={selected.has(key)} onChange={event => toggle([key], event.target.checked)} className="h-4 w-4" /><span>{changed ? "Changed" : sourceLabel(cell.source)}</span></label><select aria-label={`${employee.name}, ${calendarDate(date)}, schedule`} className={`${inputClass} w-full px-1 text-xs`} value={value} disabled={busy} onChange={event => setCellValues([key], event.target.value)}><option value="unconfigured">Unconfigured</option><option value="rest">Rest day</option><option value="default">Restore period default</option><option value="latest-default">Use latest weekly default</option><option value="saved">{scheduleLabel(cell.snapshot)} · Saved values</option>{workspace.shifts.map(shift => <option key={shift.id} value={shift.id}>{scheduleLabel(shift.snapshot)}</option>)}</select><p className={`mt-1 break-words text-xs ${value === "unconfigured" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>{label(cell)}</p>{changed && <p className="mt-1 break-words text-xs text-muted-foreground">Was: {scheduleLabel(cell.baselineSnapshot)}</p>}</td>;
        })}</tr>)}
      </tbody></table>
      {!visibleEmployees.length && <p className="p-4 text-sm">{workspace.employees.length ? "No employee matches this search. Existing selections and draft changes are retained." : "No employees are available in this branch."}</p>}
    </div>
    {prepared && <div className="space-y-2 rounded-lg border p-3"><h3 className="font-semibold">Review before confirmation</h3><p className="text-sm">{workspace.employees.length} employees · {originalCells.length} employee-days · {reviewCells.length} changed schedules. Confirmation includes filtered employees and other weeks.</p>{unconfigured > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">{unconfigured} employee-days remain unconfigured. They remain visible findings and do not create rest days or block payroll.</p>}{reviewCells.length > 0 && <details><summary className="min-h-10 cursor-pointer py-2 text-sm font-medium">See all changed schedules ({reviewCells.length})</summary><ul className="max-h-72 space-y-2 overflow-y-auto text-sm">{reviewCells.map(cell => <li key={cellKey(cell.employeeId, cell.day)} className="border-t pt-2"><strong>{employeeNames.get(cell.employeeId)}</strong> · {calendarDate(cell.day)}<span className="block break-words">{scheduleLabel(cell.baselineSnapshot)} → {label(cell)}</span><div className="mt-2 grid gap-2 sm:grid-cols-2"><div><p className="text-xs font-medium">Current</p><SnapshotDetails snapshot={cell.baselineSnapshot} /></div><div><p className="text-xs font-medium">Proposed</p><SnapshotDetails snapshot={cell.snapshot} /></div></div></li>)}</ul></details>}</div>}
    {workspace.warnings.length > 0 && <ScheduleNotice><ul className="list-inside list-disc space-y-1">{workspace.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></ScheduleNotice>}
    <footer className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
      <p className="text-sm">{changes.length ? `${changes.length} unsaved edits` : prepared ? "Ready for review" : "Apply defaults or edit a cell to begin"}</p><div className="flex flex-wrap gap-2"><ScheduleButton disabled={busy || !prepared || isUnavailable} onClick={() => onAction("save", changes)}>Save draft</ScheduleButton><ScheduleButton primary disabled={busy || !prepared || isUnavailable} onClick={() => onAction("confirm", changes)}>Confirm schedule</ScheduleButton></div>
    </footer>
    {workspace.draft && <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm">Draft options</summary><p className="my-2 text-sm text-muted-foreground">Discarding this draft retains confirmed schedules and their history.</p><ScheduleButton disabled={busy} onClick={() => onAction("delete", [])}>Delete unused draft</ScheduleButton></details>}
    {workspace.history.length > 0 && <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm">Confirmation history ({workspace.history.length})</summary><ul className="mt-3 space-y-2 text-sm">{workspace.history.map((entry, index) => <li key={`${entry.createdAt}:${index}`} className="border-t pt-2">{manilaTimestamp(entry.createdAt)} · {entry.changedCount} employee-days<details><summary className="cursor-pointer text-xs text-muted-foreground">Administrator reference</summary><span className="break-all text-xs">{entry.actorUserId}</span><span className="block break-all text-xs">Revision: {entry.revisionId}</span></details><details><summary className="min-h-10 cursor-pointer py-2">Employee-day values ({entry.changes.length})</summary><ul className="max-h-80 space-y-2 overflow-y-auto">{entry.changes.map(change => <li key={cellKey(change.employeeId, change.day)} className="border-t pt-2"><strong>{employeeNames.get(change.employeeId) ?? "Employee no longer in this branch"}</strong> · {calendarDate(change.day)}<span className="block break-words">{change.before} → {change.after}</span>{change.breaks.length > 0 && <span className="block break-words text-xs text-muted-foreground">Breaks: {change.breaks.map(item => `${item.label} ${item.fromTime}–${item.toTime}${item.deduct ? " unpaid" : " paid"}`).join("; ")}</span>}</li>)}</ul></details></li>)}</ul></details>}
  </section>;
}
