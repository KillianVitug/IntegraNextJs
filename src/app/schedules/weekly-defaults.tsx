"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getWeeklyDefaultsPreview } from "@/app/actions/scheduleWorkspaceAction";
import { scheduleLabel } from "@/lib/scheduling/model";
import { scheduleChoiceLabels } from "@/lib/scheduling/presentation";
import type { ScheduleArchiveCommand, ScheduleWeekday, ScheduleWeeklyCommand, ScheduleWeeklyPreview, ScheduleWeeklyPreviewInput, ScheduleWorkspace } from "@/lib/scheduling/workspace-types";
import { calendarDate, Field, inputClass, ScheduleButton, ScheduleNotice, weekdays } from "./schedule-ui";

type Props = {
  workspace: ScheduleWorkspace;
  employeeId?: string;
  busy: boolean;
  onDirty: (value: boolean) => void;
  savedRevision: number;
  reviewRevision: number;
  onSave: (value: Pick<ScheduleWeeklyCommand, "effectiveFrom" | "effectiveTo" | "employeeIds" | "days" | "reuseFromDate" | "previewDigest">) => Promise<void>;
  onArchive: (value: Pick<ScheduleArchiveCommand, "employeeId" | "patternId" | "endDate">) => Promise<void>;
};

export function WeeklyDefaults({ workspace, employeeId, busy, savedRevision, reviewRevision, onDirty, onSave, onArchive }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(employeeId && workspace.employees.some(employee => employee.id === employeeId) ? [employeeId] : []));
  const [search, setSearch] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(workspace.effectiveDate);
  const [effectiveTo, setEffectiveTo] = useState("");
  const [days, setDays] = useState<Partial<Record<ScheduleWeekday, string>>>({});
  const [selectedDays, setSelectedDays] = useState<Set<ScheduleWeekday>>(new Set());
  const [editWeekdays, setEditWeekdays] = useState(false);
  const choiceLabels = useMemo(() => scheduleChoiceLabels(workspace.shifts), [workspace.shifts]);
  const [bulkValue, setBulkValue] = useState("rest");
  const [endDates, setEndDates] = useState<Record<number, string>>({});
  const visibleEmployees = workspace.employees.filter(employee => `${employee.name} ${employee.employeeNo}`.toLowerCase().includes(search.toLowerCase()));
  const configuredDays = weekdays.filter(weekday => days[weekday] !== undefined);
  const allVisibleSelected = visibleEmployees.length > 0 && visibleEmployees.every(employee => selected.has(employee.id));
  const dateInvalid = !effectiveFrom || Boolean(effectiveTo && effectiveTo < effectiveFrom);
  const changedDays = configuredDays.map(weekday => ({ weekday, value: days[weekday]! }));
  const selectedEmployees = workspace.employees.filter(employee => selected.has(employee.id));
  const extendsSavedWeek = selectedEmployees.some(employee => {
    const pattern = employee.weeklyHistory.filter(pattern => pattern.effectiveFrom <= workspace.effectiveDate && (!pattern.effectiveTo || pattern.effectiveTo >= workspace.effectiveDate)).sort((a, b) => b.id - a.id)[0];
    return Boolean(pattern && pattern.effectiveFrom > effectiveFrom);
  });
  const reuse = Boolean(effectiveFrom && effectiveFrom < workspace.effectiveDate && (!configuredDays.length || extendsSavedWeek));
  const [review, setReview] = useState<{ key: string; result?: ScheduleWeeklyPreview; error?: string } | null>(null);
  const [reviewRetry, setReviewRetry] = useState(0);
  const [savedKey, setSavedKey] = useState("");
  const inputKey = JSON.stringify({ departmentId: workspace.departmentId, sourceDigest: workspace.weeklyDigest, effectiveFrom, effectiveTo: effectiveTo || null, employeeIds: [...selected].sort(), days: changedDays, ...(reuse ? { reuseFromDate: workspace.effectiveDate } : {}) });
  const intentKey = JSON.stringify({ effectiveFrom, effectiveTo, employeeIds: [...selected].sort(), days: changedDays });
  const reviewKey = `${inputKey}:${reviewRevision}:${reviewRetry}`;
  const intentRef = useRef(intentKey);
  intentRef.current = intentKey;
  const completedRevision = useRef(savedRevision);
  useEffect(() => {
    if (savedRevision === completedRevision.current) return;
    completedRevision.current = savedRevision;
    // Preserve scope, dates and the source week after readback, including receipt recovery.
    setSavedKey(intentRef.current);
  }, [savedRevision]);
  const canReview = workspace.departmentId !== null && selected.size > 0 && selected.size <= 100 && !dateInvalid && (reuse || configuredDays.length > 0);
  useEffect(() => {
    if (!canReview) return;
    let current = true;
    const timer = window.setTimeout(() => {
      getWeeklyDefaultsPreview(JSON.parse(inputKey) as ScheduleWeeklyPreviewInput).then(result => {
        if (current) setReview({ key: reviewKey, result });
      }).catch(cause => {
        if (current) setReview({ key: reviewKey, error: cause instanceof Error ? cause.message : "The date check could not load. Your selections and edits are retained." });
      });
    }, 200);
    return () => { current = false; window.clearTimeout(timer); };
  }, [inputKey, canReview, reviewKey]);
  const preview = canReview && review?.key === reviewKey ? review.result : undefined;
  const reviewError = canReview && review?.key === reviewKey ? review.error : undefined;
  const checking = canReview && !preview && !reviewError;
  const saved = savedKey === intentKey;
  const ranges = [...new Set(preview?.employees.map(employee => `${calendarDate(employee.effectiveFrom)}${employee.effectiveTo ? ` – ${calendarDate(employee.effectiveTo)}` : " onward"}`) ?? [])];
  const retained = preview?.employees.filter(employee => employee.retainedAssignments.length > 0) ?? [];
  const rangeSummary = ranges.length === 1 ? ranges[0] : ranges.length ? "Dates vary by employee" : effectiveFrom ? `${calendarDate(effectiveFrom)}${effectiveTo ? ` – ${calendarDate(effectiveTo)}` : reuse ? " · checking end dates" : " onward"}` : "Choose a start date";

  function toggleEmployees(ids: string[], checked: boolean) {
    if (busy) return;
    setSelected(previous => { const next = new Set(previous); ids.forEach(id => checked ? next.add(id) : next.delete(id)); return next; }); onDirty(true);
  }
  function setDay(weekday: ScheduleWeekday, value: string) {
    setDays(previous => { const next = { ...previous }; if (value === "keep") delete next[weekday]; else next[weekday] = value; return next; }); onDirty(true);
  }
  function valueLabel(value?: string) {
    if (value === undefined) return "Keep existing";
    if (value === "rest") return "Rest day";
    if (value === "unconfigured") return "Unconfigured";
    const shift = workspace.shifts.find(shift => String(shift.id) === value);
    return shift ? scheduleLabel(shift.snapshot) : "Saved schedule";
  }

  return <section aria-label="Weekly defaults" className="min-w-0 space-y-4">
    <div><h2 className="text-lg font-semibold">Normal working week</h2><p className="text-sm text-muted-foreground">Select employees. Choose an earlier start to reuse their saved week, or edit weekdays below. Confirmed period schedules retain their reviewed values.</p></div>
    <div className="grid gap-3 rounded-lg border bg-muted/25 p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Effective from"><input type="date" name="weekly-effective-from" disabled={busy} className={inputClass} value={effectiveFrom} onChange={event => { setEffectiveFrom(event.target.value); onDirty(true); }} /></Field>
      <Field label="Effective through (optional)"><input type="date" name="weekly-effective-through" min={effectiveFrom} disabled={busy} className={inputClass} value={effectiveTo || (reuse && preview?.employees.length && new Set(preview.employees.map(employee => employee.effectiveTo)).size === 1 ? preview.employees[0].effectiveTo ?? "" : "")} onChange={event => { setEffectiveTo(event.target.value); onDirty(true); }} />{reuse && !effectiveTo && <span className="text-xs font-normal text-muted-foreground">{ranges.length > 1 ? "Automatic end dates are listed below for each employee." : "Ends automatically before each employee’s saved week begins."}</span>}</Field>
      <div className="lg:col-span-2"><Field label="Find employees"><input type="search" className={`${inputClass} w-full`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or employee number" /></Field></div>
    </div>
    {selected.size > 100 && <ScheduleNotice error>Select at most 100 employees for one weekly update. Selected employees remain visible in the review below.</ScheduleNotice>}
    {dateInvalid && <ScheduleNotice error>Enter a valid effective-from date. The optional end date must be on or after it.</ScheduleNotice>}
    <div aria-live="polite" aria-atomic="true">
      {reuse && !canReview && !dateInvalid && <ScheduleNotice>Select employees to reuse their saved week shown as of {calendarDate(workspace.effectiveDate)}, starting {calendarDate(effectiveFrom)}. Each employee keeps their own shifts, breaks and rest days.</ScheduleNotice>}
      {checking && <ScheduleNotice>Checking dates and saved schedules… Your shown week and edits stay in place.</ScheduleNotice>}
      {reviewError && <ScheduleNotice error><p>{reviewError}</p><ScheduleButton className="mt-2" disabled={busy} onClick={() => { setReview(null); setReviewRetry(value => value + 1); }}>Retry date check</ScheduleButton></ScheduleNotice>}
      {preview && <ScheduleNotice error={!preview.canSave}>
        <p className="font-medium">{saved ? "Saved" : reuse ? "Reuse saved weeks" : "Review weekly changes"}: {selected.size} employees · {rangeSummary}</p>
        {reuse && <p className="mt-1">Copy each employee’s seven weekdays shown as of {calendarDate(workspace.effectiveDate)}{configuredDays.length ? `, including your ${configuredDays.length} weekday edits below` : ""}. Later weekly defaults stay in place.</p>}
        {ranges.length > 1 && <ul className="mt-2 space-y-1">{preview.employees.map(employee => <li key={employee.employeeId}>{employee.name}: {calendarDate(employee.effectiveFrom)}{employee.effectiveTo ? ` – ${calendarDate(employee.effectiveTo)}` : " onward"}</li>)}</ul>}
        {preview.blockers.length > 0 && <ul className="mt-2 list-inside list-disc space-y-1">{preview.blockers.map((message, index) => <li key={index}>{message}</li>)}</ul>}
        {retained.length > 0 && <div className="mt-2"><p className="font-medium">Confirmed period schedules and date exceptions stay unchanged, including saved Unconfigured days. Review those dates in Period schedule if they also need changes.</p><details className="mt-1"><summary className="min-h-10 cursor-pointer py-2">Dates that stay unchanged</summary><ul className="space-y-1">{retained.flatMap(employee => employee.retainedAssignments.map((range, index) => <li key={`${employee.employeeId}:${index}`}>{employee.name}: {calendarDate(range.from)}{range.to && range.to !== range.from ? ` – ${calendarDate(range.to)}` : !range.to ? " onward" : ""} · {range.kind === "confirmed" ? "Confirmed period schedule" : "Date exception"}</li>))}</ul></details></div>}
        {preview.payrollMayChange && <p className="mt-2">Affected attendance will be refreshed; provisional payroll may need recalculation. Approved or posted payroll remains protected.</p>}
        <p className="mt-1 text-xs">Includes selected employees hidden by search.</p>
      </ScheduleNotice>}
    </div>
    <details open={!reuse || configuredDays.length > 0 || editWeekdays} onToggle={event => { if (reuse && !configuredDays.length) setEditWeekdays(event.currentTarget.open); }} className="rounded-lg border p-3">
      <summary className={reuse && !configuredDays.length ? "min-h-10 cursor-pointer py-2 text-sm font-medium" : "hidden"}>Change weekdays (optional)</summary>
      <div className="mb-3 flex flex-wrap items-end gap-2"><div className="min-w-0 basis-full flex-1 sm:basis-0"><Field label="Assign one shift to selected weekdays"><select className={inputClass} value={bulkValue} onChange={event => setBulkValue(event.target.value)}><option value="rest">Rest day</option><option value="unconfigured">Unconfigured</option>{workspace.shifts.map(shift => <option key={shift.id} value={shift.id}>{choiceLabels.get(shift.id)}</option>)}</select></Field>{workspace.shifts.some(shift => String(shift.id) === bulkValue) && <details className="mt-1 break-words text-xs text-muted-foreground"><summary className="min-h-10 cursor-pointer py-2">Shift details</summary><p>{valueLabel(bulkValue)}</p></details>}</div><ScheduleButton disabled={!selectedDays.size || busy} onClick={() => { setDays(previous => ({ ...previous, ...Object.fromEntries([...selectedDays].map(weekday => [weekday, bulkValue])) })); onDirty(true); }}>Assign weekdays</ScheduleButton></div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">{weekdays.map(weekday => <div key={weekday} className="min-w-0 rounded-md border p-2"><label className="mb-1 flex min-h-8 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4" disabled={busy} checked={selectedDays.has(weekday)} onChange={event => setSelectedDays(previous => { const next = new Set(previous); if (event.target.checked) next.add(weekday); else next.delete(weekday); return next; })} />{weekday.slice(0, 3)}</label><select aria-label={`${weekday} default`} className={`${inputClass} w-full px-1 text-xs`} value={days[weekday] ?? "keep"} disabled={busy} onChange={event => setDay(weekday, event.target.value)}><option value="keep">Keep existing</option><option value="rest">Rest day</option><option value="unconfigured">Unconfigured</option>{workspace.shifts.map(shift => <option key={shift.id} value={shift.id}>{choiceLabels.get(shift.id)}</option>)}</select>{days[weekday] !== undefined && <p className="mt-1 break-words text-xs text-muted-foreground">{valueLabel(days[weekday])}</p>}</div>)}</div>
      <p className="mt-2 text-xs text-muted-foreground">{reuse ? "Keep existing copies each employee’s shown weekday, including its saved breaks and rest-day status." : "Keep existing preserves each employee’s weekday at the effective date."} Unconfigured is distinct from a rest day.</p>
    </details>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{selected.size} employees selected · {visibleEmployees.length} shown · defaults shown as of {calendarDate(workspace.effectiveDate)}</span>{selected.size > 0 && <ScheduleButton disabled={busy} onClick={() => { setSelected(new Set()); onDirty(true); }}>Clear employee selection</ScheduleButton>}</div>
    <div className="max-w-full overflow-x-auto rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} role="region" aria-label="Weekly defaults grid, scroll horizontally to see all weekdays">
      <table className="w-full min-w-[1000px] table-fixed border-collapse text-sm"><caption className="sr-only">Current weekly defaults and proposed changes for selected employees</caption><thead className="bg-muted"><tr><th className="sticky left-0 z-10 w-52 bg-muted p-3 text-left"><label className="flex min-h-10 items-center gap-2"><input type="checkbox" className="h-4 w-4" aria-label="Select all visible employees" disabled={busy} checked={allVisibleSelected} onChange={event => toggleEmployees(visibleEmployees.map(employee => employee.id), event.target.checked)} />Employee</label></th>{weekdays.map(weekday => <th key={weekday} className="border-l p-2 text-left">{weekday.slice(0, 3)}</th>)}</tr></thead><tbody>{visibleEmployees.map(employee => <tr key={employee.id} className={`border-t ${selected.has(employee.id) ? "bg-blue-50 dark:bg-blue-950/50" : ""}`}><th scope="row" className="sticky left-0 z-10 bg-background p-3 text-left align-top"><label className="flex min-h-10 items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" aria-label={`Select ${employee.name}`} disabled={busy} checked={selected.has(employee.id)} onChange={event => toggleEmployees([employee.id], event.target.checked)} /><span className="min-w-0 break-words font-medium">{employee.name}<span className="block text-xs font-normal text-muted-foreground">{employee.employeeNo}</span></span></label></th>{weekdays.map(weekday => { const current = employee.weeklyDays.find(item => item.weekday === weekday), proposed = selected.has(employee.id) ? days[weekday] : undefined, reviewed = preview?.employees.find(item => item.employeeId === employee.id)?.days.find(item => item.weekday === weekday); return <td key={weekday} className="border-l p-2 align-top"><p className={`break-words text-xs ${current?.value === "unconfigured" ? "text-amber-700 dark:text-amber-400" : ""}`}>{current?.label ?? "Unconfigured"}</p>{(reviewed ? reviewed.label !== current?.label : proposed !== undefined) && <p className="mt-1 break-words text-xs font-semibold">→ {reviewed?.label ?? valueLabel(proposed)}</p>}</td>; })}</tr>)}</tbody></table>
      {!visibleEmployees.length && <p className="p-4 text-sm">{workspace.employees.length ? "No employee matches this search. Selected employees remain selected." : "No employees are available in this branch."}</p>}
    </div>
    {selected.size > 0 && <details className="rounded-lg border p-3 text-sm"><summary className="min-h-10 cursor-pointer py-2">Selected employees{configuredDays.length ? " and weekday edits" : ""}</summary><p className="mt-1 break-words">{selectedEmployees.map(employee => employee.name).join(", ")}</p>{changedDays.length > 0 && <ul className="mt-1 space-y-1">{changedDays.map(item => <li key={item.weekday}>{item.weekday}: {valueLabel(item.value)}</li>)}</ul>}</details>}
    <footer className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur"><span className="text-sm">{saved ? "Saved · " : ""}{selected.size} employees · {reuse ? "7 weekdays each" : `${configuredDays.length} weekdays to update`}{selected.size > 0 ? ` · ${rangeSummary}` : ""}</span><ScheduleButton primary disabled={busy || saved || !preview?.canSave || checking} onClick={() => onSave({ employeeIds: [...selected].sort(), days: changedDays, effectiveFrom, effectiveTo: effectiveTo || null, ...(reuse ? { reuseFromDate: workspace.effectiveDate } : {}), previewDigest: preview?.previewDigest })}>Save weekly defaults</ScheduleButton></footer>
    <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">Weekly history and end dates</summary><p className="my-2 text-sm text-muted-foreground">End-date a pattern to retain its history. Current period confirmations are preserved. Use employee search above to narrow this list. Save or discard any weekday edits before ending a pattern.</p><div className="space-y-3">{visibleEmployees.filter(employee => employee.weeklyHistory.length).map(employee => <div key={employee.id} className="border-t pt-3"><h3 className="text-sm font-semibold">{employee.name}</h3>{employee.weeklyHistory.map(pattern => <div key={pattern.id} className="mt-2 flex flex-wrap items-end gap-2"><p className="min-w-0 flex-1 text-sm">{calendarDate(pattern.effectiveFrom)} – {pattern.effectiveTo ? calendarDate(pattern.effectiveTo) : "Ongoing"}</p><Field label="End date"><input aria-label={`End date for ${employee.name}, pattern starting ${pattern.effectiveFrom}`} type="date" min={pattern.effectiveFrom} className={inputClass} disabled={busy} value={endDates[pattern.id] ?? pattern.effectiveTo ?? ""} onChange={event => { setEndDates(previous => ({ ...previous, [pattern.id]: event.target.value })); onDirty(true); }} /></Field><ScheduleButton disabled={busy || configuredDays.length > 0 || !(endDates[pattern.id] ?? pattern.effectiveTo)} onClick={() => onArchive({ employeeId: employee.id, patternId: pattern.id, endDate: endDates[pattern.id] ?? pattern.effectiveTo! })}>Save end date</ScheduleButton></div>)}</div>)}</div>{!visibleEmployees.some(employee => employee.weeklyHistory.length) && <p className="text-sm">No weekly patterns for the employees shown.</p>}</details>
  </section>;
}
