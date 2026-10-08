"use client";

import { useState } from "react";
import type { ScheduleArchiveCommand, ScheduleWeekday, ScheduleWeeklyCommand, ScheduleWorkspace } from "@/lib/scheduling/workspace-types";
import { calendarDate, Field, inputClass, ScheduleButton, ScheduleNotice, weekdays } from "./schedule-ui";

type Props = {
  workspace: ScheduleWorkspace;
  employeeId?: string;
  busy: boolean;
  onDirty: (value: boolean) => void;
  onReviewDate: (effectiveDate: string) => Promise<void>;
  onSave: (value: Pick<ScheduleWeeklyCommand, "effectiveFrom" | "effectiveTo" | "employeeIds" | "days">) => Promise<void>;
  onArchive: (value: Pick<ScheduleArchiveCommand, "employeeId" | "patternId" | "endDate">) => Promise<void>;
};

export function WeeklyDefaults({ workspace, employeeId, busy, onDirty, onReviewDate, onSave, onArchive }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(employeeId && workspace.employees.some(employee => employee.id === employeeId) ? [employeeId] : []));
  const [search, setSearch] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(workspace.effectiveDate);
  const [effectiveTo, setEffectiveTo] = useState("");
  const [days, setDays] = useState<Partial<Record<ScheduleWeekday, string>>>({});
  const [selectedDays, setSelectedDays] = useState<Set<ScheduleWeekday>>(new Set());
  const [bulkValue, setBulkValue] = useState("rest");
  const [endDates, setEndDates] = useState<Record<number, string>>({});
  const visibleEmployees = workspace.employees.filter(employee => `${employee.name} ${employee.employeeNo}`.toLowerCase().includes(search.toLowerCase()));
  const configuredDays = weekdays.filter(weekday => days[weekday] !== undefined);
  const allVisibleSelected = visibleEmployees.length > 0 && visibleEmployees.every(employee => selected.has(employee.id));
  const dateInvalid = !effectiveFrom || Boolean(effectiveTo && effectiveTo < effectiveFrom);
  const needsDateReview = effectiveFrom !== workspace.effectiveDate;
  const changedDays = configuredDays.map(weekday => ({ weekday, value: days[weekday]! }));
  const selectedEmployees = workspace.employees.filter(employee => selected.has(employee.id));

  function toggleEmployees(ids: string[], checked: boolean) {
    setSelected(previous => { const next = new Set(previous); ids.forEach(id => checked ? next.add(id) : next.delete(id)); return next; });
  }
  function setDay(weekday: ScheduleWeekday, value: string) {
    setDays(previous => { const next = { ...previous }; if (value === "keep") delete next[weekday]; else next[weekday] = value; return next; }); onDirty(true);
  }
  function valueLabel(value?: string) {
    if (value === undefined) return "Keep existing";
    if (value === "rest") return "Rest day";
    if (value === "unconfigured") return "Unconfigured";
    return workspace.shifts.find(shift => String(shift.id) === value)?.label ?? "Saved schedule";
  }

  return <section aria-label="Weekly defaults" className="min-w-0 space-y-4">
    <div><h2 className="text-lg font-semibold">Normal working week</h2><p className="text-sm text-muted-foreground">Select employees and weekdays, then save an effective-dated default. Confirmed period schedules retain their reviewed values.</p></div>
    <div className="grid gap-3 rounded-lg border bg-muted/25 p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Effective from"><input type="date" className={inputClass} value={effectiveFrom} onChange={event => { setEffectiveFrom(event.target.value); onDirty(true); }} /></Field>
      <Field label="Effective through (optional)"><input type="date" min={effectiveFrom} className={inputClass} value={effectiveTo} onChange={event => { setEffectiveTo(event.target.value); onDirty(true); }} /></Field>
      <div className="lg:col-span-2"><Field label="Find employees"><input type="search" className={`${inputClass} w-full`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or employee number" /></Field></div>
    </div>
    {selected.size > 100 && <ScheduleNotice error>Select at most 100 employees for one weekly update. Selected employees remain visible in the review below.</ScheduleNotice>}
    {dateInvalid && <ScheduleNotice error>Enter a valid effective-from date. The optional end date must be on or after it.</ScheduleNotice>}
    {needsDateReview && <ScheduleNotice><p>Current defaults are shown as of {calendarDate(workspace.effectiveDate)}. Review the defaults for {effectiveFrom ? calendarDate(effectiveFrom) : "your effective date"} before saving. Your selected employees and weekday edits will be retained.</p><ScheduleButton className="mt-2" disabled={busy || !effectiveFrom} onClick={() => onReviewDate(effectiveFrom)}>Review effective date</ScheduleButton></ScheduleNotice>}
    <div className="rounded-lg border p-3">
      <div className="mb-3 flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1"><Field label="Assign one shift to selected weekdays"><select className={inputClass} value={bulkValue} onChange={event => setBulkValue(event.target.value)}><option value="rest">Rest day</option><option value="unconfigured">Unconfigured</option>{workspace.shifts.map(shift => <option key={shift.id} value={shift.id}>{shift.label}</option>)}</select></Field></div><ScheduleButton disabled={!selectedDays.size || busy} onClick={() => { setDays(previous => ({ ...previous, ...Object.fromEntries([...selectedDays].map(weekday => [weekday, bulkValue])) })); onDirty(true); }}>Assign weekdays</ScheduleButton></div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">{weekdays.map(weekday => <div key={weekday} className="min-w-0 rounded-md border p-2"><label className="mb-1 flex min-h-8 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4" checked={selectedDays.has(weekday)} onChange={event => setSelectedDays(previous => { const next = new Set(previous); if (event.target.checked) next.add(weekday); else next.delete(weekday); return next; })} />{weekday.slice(0, 3)}</label><select aria-label={`${weekday} default`} className={`${inputClass} w-full px-1 text-xs`} value={days[weekday] ?? "keep"} disabled={busy} onChange={event => setDay(weekday, event.target.value)}><option value="keep">Keep existing</option><option value="rest">Rest day</option><option value="unconfigured">Unconfigured</option>{workspace.shifts.map(shift => <option key={shift.id} value={shift.id}>{shift.label}</option>)}</select></div>)}</div>
      <p className="mt-2 text-xs text-muted-foreground">Keep existing preserves each employee’s weekday. Unconfigured is distinct from a rest day.</p>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{selected.size} employees selected · {visibleEmployees.length} shown · defaults shown as of {calendarDate(workspace.effectiveDate)}</span>{selected.size > 0 && <ScheduleButton onClick={() => setSelected(new Set())}>Clear employee selection</ScheduleButton>}</div>
    <div className="max-w-full overflow-x-auto rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} role="region" aria-label="Weekly defaults grid, scroll horizontally to see all weekdays">
      <table className="w-full min-w-[1000px] table-fixed border-collapse text-sm"><caption className="sr-only">Current weekly defaults and proposed changes for selected employees</caption><thead className="bg-muted"><tr><th className="sticky left-0 z-10 w-52 bg-muted p-3 text-left"><label className="flex min-h-10 items-center gap-2"><input type="checkbox" className="h-4 w-4" aria-label="Select all visible employees" checked={allVisibleSelected} onChange={event => toggleEmployees(visibleEmployees.map(employee => employee.id), event.target.checked)} />Employee</label></th>{weekdays.map(weekday => <th key={weekday} className="border-l p-2 text-left">{weekday.slice(0, 3)}</th>)}</tr></thead><tbody>{visibleEmployees.map(employee => <tr key={employee.id} className={`border-t ${selected.has(employee.id) ? "bg-blue-50 dark:bg-blue-950/50" : ""}`}><th scope="row" className="sticky left-0 z-10 bg-background p-3 text-left align-top"><label className="flex min-h-10 items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" aria-label={`Select ${employee.name}`} checked={selected.has(employee.id)} onChange={event => toggleEmployees([employee.id], event.target.checked)} /><span className="min-w-0 break-words font-medium">{employee.name}<span className="block text-xs font-normal text-muted-foreground">{employee.employeeNo}</span></span></label></th>{weekdays.map(weekday => { const current = employee.weeklyDays.find(item => item.weekday === weekday), proposed = selected.has(employee.id) ? days[weekday] : undefined; return <td key={weekday} className="border-l p-2 align-top"><p className={`break-words text-xs ${current?.value === "unconfigured" ? "text-amber-700 dark:text-amber-400" : ""}`}>{current?.label ?? "Unconfigured"}</p>{proposed !== undefined && <p className="mt-1 break-words text-xs font-semibold">→ {valueLabel(proposed)}</p>}</td>; })}</tr>)}</tbody></table>
      {!visibleEmployees.length && <p className="p-4 text-sm">{workspace.employees.length ? "No employee matches this search. Selected employees remain selected." : "No employees are available in this branch."}</p>}
    </div>
    {selected.size > 0 && configuredDays.length > 0 && <ScheduleNotice><p className="font-medium">Review: {selected.size} employees · {configuredDays.length} weekdays</p><p className="mt-1">Effective {effectiveFrom ? calendarDate(effectiveFrom) : "date required"}{effectiveTo ? ` through ${calendarDate(effectiveTo)}` : " onward"}. Saving includes selected employees hidden by search. Existing period confirmations remain unchanged.</p><details className="mt-2"><summary className="cursor-pointer py-1">Selected employees and changes</summary><p className="mt-1 break-words">{selectedEmployees.map(employee => employee.name).join(", ")}</p><ul className="mt-1 space-y-1">{changedDays.map(item => <li key={item.weekday}>{item.weekday}: {valueLabel(item.value)}</li>)}</ul></details></ScheduleNotice>}
    <footer className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur"><span className="text-sm">{selected.size} employees · {configuredDays.length} weekdays to update</span><ScheduleButton primary disabled={busy || !selected.size || selected.size > 100 || !configuredDays.length || dateInvalid || needsDateReview || workspace.departmentId === null} onClick={() => onSave({ employeeIds: [...selected], days: changedDays, effectiveFrom, effectiveTo: effectiveTo || null })}>Save weekly defaults</ScheduleButton></footer>
    <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">Weekly history and end dates</summary><p className="my-2 text-sm text-muted-foreground">End-date a pattern to retain its history. Current period confirmations are preserved. Use employee search above to narrow this list. Save or discard any weekday edits before ending a pattern.</p><div className="space-y-3">{visibleEmployees.filter(employee => employee.weeklyHistory.length).map(employee => <div key={employee.id} className="border-t pt-3"><h3 className="text-sm font-semibold">{employee.name}</h3>{employee.weeklyHistory.map(pattern => <div key={pattern.id} className="mt-2 flex flex-wrap items-end gap-2"><p className="min-w-0 flex-1 text-sm">{calendarDate(pattern.effectiveFrom)} – {pattern.effectiveTo ? calendarDate(pattern.effectiveTo) : "Ongoing"}</p><Field label="End date"><input aria-label={`End date for ${employee.name}, pattern starting ${pattern.effectiveFrom}`} type="date" min={pattern.effectiveFrom} className={inputClass} value={endDates[pattern.id] ?? pattern.effectiveTo ?? ""} onChange={event => { setEndDates(previous => ({ ...previous, [pattern.id]: event.target.value })); onDirty(true); }} /></Field><ScheduleButton disabled={busy || configuredDays.length > 0 || !(endDates[pattern.id] ?? pattern.effectiveTo)} onClick={() => onArchive({ employeeId: employee.id, patternId: pattern.id, endDate: endDates[pattern.id] ?? pattern.effectiveTo! })}>Save end date</ScheduleButton></div>)}</div>)}</div>{!visibleEmployees.some(employee => employee.weeklyHistory.length) && <p className="text-sm">No weekly patterns for the employees shown.</p>}</details>
  </section>;
}
