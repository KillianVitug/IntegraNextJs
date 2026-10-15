"use client";
import { useState } from "react";
import Link from "next/link";
import type { ManagerAttendanceDay, ManagerAttendanceOverview, ManagerFindingCode } from "@/lib/manager/oversight-types";

const views = ["all", "attention", "scheduled-no-attendance", "punches", "schedule", "held", "overtime", "late", "corrected"] as const;
type View = typeof views[number];
const labels: Record<View, string> = { all: "All employees", attention: "Needs action", "scheduled-no-attendance": "Scheduled, no attendance", punches: "Punch problems", schedule: "Schedule problems", held: "Held / new evidence", overtime: "Overtime recorded", late: "Late / undertime", corrected: "Corrected days" };
const button = "inline-flex min-h-11 items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium";
const input = "min-h-11 w-full rounded-lg border bg-background px-3 text-base";
const time = (value: string) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
const duration = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
function matches(day: ManagerAttendanceDay, view: View) {
  if (view === "all") return true;
  if (day.phase !== "recorded") return false;
  if (view === "attention") return day.needsAction;
  const codes: ManagerFindingCode[] = view === "held" ? ["hold", "new-evidence"] : view === "schedule" ? ["schedule", "rest-work"] : [view];
  return day.findings.some(finding => codes.includes(finding.code));
}
function dayStatus(day: ManagerAttendanceDay) {
  if (day.phase === "outside-employment") return "Outside current employment dates";
  if (day.phase === "future") return "Future schedule";
  if (day.phase === "in-progress") return "Workday in progress";
  if (day.phase === "after-cutoff") return "After selected recorded cutoff";
  if (day.held) return "Held for administrator review";
  if (day.leaveCoverage === "partial-day") return "Partial leave — attendance review needed";
  if (day.approvedLeave) return "Approved leave on file";
  if (day.reviewedNoWork) return "Reviewed non-work decision on file";
  if (!day.scheduleConfigured) return "Schedule unconfigured";
  if (day.needsAction) return "Needs attention";
  if (day.workedMinutes > 0) return "Recorded attendance";
  return day.isRestDay ? "Rest day" : "No attendance received";
}

export function ManagerProvisionalWorkspace({ data, initialDay, initialView, focusedEmployeeId }: { data: ManagerAttendanceOverview; initialDay?: string; initialView?: string; focusedEmployeeId?: string }) {
  const [view, setView] = useState<View>(views.includes(initialView as View) ? initialView as View : "all");
  const [pinnedDay, setPinnedDay] = useState(initialDay);
  const [search, setSearch] = useState("");
  const selected = data.departments.find(row => row.id === data.departmentId);
  const query = new URLSearchParams({ ...(data.departmentId ? { departmentId: String(data.departmentId) } : {}), ...(data.period ? { periodId: data.period.id } : {}), asOfDate: data.asOfDate });
  const rows = data.employees.filter(employee => `${employee.name} ${employee.employeeNo}`.toLowerCase().includes(search.trim().toLowerCase())).map(employee => ({ employee, days: employee.days.filter(day => matches(day, view) || day.date === pinnedDay) })).filter(item => view === "all" || item.days.length > 0);
  const matchingDayCount = rows.reduce((total, item) => total + item.days.filter(day => matches(day, view)).length, 0);
  function changeView(value: View) {
    setView(value);
    setPinnedDay(undefined);
    const next = new URLSearchParams(window.location.search); next.set("view", value); next.delete("day");
    history.replaceState(null, "", `/managerProvisional?${next}`);
  }
  return <div className="min-w-0 space-y-5">
    <header className="space-y-2"><p className="text-sm font-semibold text-blue-700 dark:text-blue-300">Manager oversight</p><h1 className="text-2xl font-semibold">Provisional payroll — attendance only</h1><p className="text-sm text-muted-foreground">Review the time and unresolved workdays behind payroll. Financial details remain confidential. Payroll Admin handles decisions and final payroll.</p><Link href="/managerHome" className={button}>Manager home</Link></header>
    <form method="get" action="/managerProvisional" className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="space-y-1 text-sm font-medium">Branch<select className={input} name="departmentId" defaultValue={data.departmentId ?? ""} disabled={!data.departments.length}>{!data.departments.length && <option value="">No assigned branch</option>}{data.departments.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label className="space-y-1 text-sm font-medium">Period<select className={input} name="periodId" defaultValue={data.period?.id ?? ""} disabled={!data.periods.length}>{!data.periods.length && <option value="">No available period</option>}{data.periods.map(period => <option key={period.id} value={period.id}>{period.code} · {period.startDate} to {period.endDate}</option>)}</select></label>
      <label className="space-y-1 text-sm font-medium">Recorded through<input className={input} type="date" name="asOfDate" defaultValue={data.asOfDate} max={new Date(Date.parse(`${data.today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)} required /></label>
      <button className={`${button} self-end bg-blue-700 text-white`} type="submit" disabled={!data.departments.length || !data.period}>Load selection</button>
    </form>
    <div className="space-y-2 rounded-xl border bg-muted/20 p-4 text-sm"><p><strong>{selected?.name ?? "No branch assigned"}</strong> · {data.period?.code ?? "No period"} · Counts through {data.asOfDate}, Philippine time.</p><p>{data.freshness.lastSourceSeenAt ? `Last source observation: ${time(data.freshness.lastSourceSeenAt)}. ` : ""}{data.freshness.message}</p><p>{data.scopeNotice}</p><p className="text-muted-foreground">No attendance received does not establish absence. Today's and future schedules are plans; they are excluded from completed-workday action counts. Overtime minutes and an approval on file do not establish paid overtime.</p></div>
    {focusedEmployeeId && <Link className={button} href={`/managerProvisional?${query}`}>Back to all branch employees</Link>}
    <section aria-label="Attendance review counts" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
      { label: "Employees in this selection", value: data.counts.employees },
      { label: "Employees needing action", value: data.counts.actionEmployees },
      { label: "Workdays needing action", value: data.counts.actionDays },
      { label: "Scheduled, no attendance", value: data.counts.scheduledNoAttendanceDays },
    ].map(card => <div className="rounded-xl border p-4" key={card.label}><p className="text-2xl font-semibold">{card.value}</p><p className="mt-1 text-sm text-muted-foreground">{card.label}</p></div>)}</section>
    <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm font-medium">Find an employee<input className={input} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or employee number" /></label><label className="space-y-1 text-sm font-medium">Show<select className={input} value={view} onChange={event => changeView(event.target.value as View)}>{views.map(item => <option key={item} value={item}>{labels[item]}</option>)}</select></label></div>
    <p className="text-sm" aria-live="polite">{rows.length} employees{view === "all" ? "" : ` · ${matchingDayCount} matching workdays`}. Search and filters do not change the selection totals above.</p>
    {!data.departments.length ? <p className="rounded-xl border p-5">No branch is assigned to this account. Ask the account administrator to assign the intended branch.</p>
      : !rows.length ? <p className="rounded-xl border p-5">{data.employees.length ? "No employees match this search and filter." : "No current employees are available for this selection."}</p>
      : <div className="space-y-4">{rows.map(({ employee, days }) => <section key={employee.employeeId} className="min-w-0 rounded-xl border p-4"><header className="mb-3"><h2 className="font-semibold">{employee.name}</h2><p className="text-sm text-muted-foreground">{employee.employeeNo} · {employee.actionDays} workdays need action through the selected cutoff</p></header><div className="space-y-2">{days.map(day => <details id={`day-${employee.employeeId}-${day.date}`} key={day.date} open={initialDay === day.date} className="group rounded-lg border bg-background">
        <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm"><span className="font-semibold">{dateLabel(day.date)}</span><span className="ml-2">{dayStatus(day)}</span>{day.phase === "recorded" && day.workedMinutes > 0 && <span className="ml-2 text-muted-foreground">{duration(day.workedMinutes)} recorded</span>}</summary>
        <div className="space-y-3 border-t p-3 text-sm"><p>Schedule: {day.scheduleConfigured ? day.isRestDay ? "Rest day" : `${day.scheduleIn ?? "Flexible"} – ${day.scheduleOut ?? "Flexible"}` : "Not configured"} · {day.scheduleSource}</p>
          {!!day.breaks.length && <ul className="list-disc space-y-1 pl-5">{day.breaks.map((window, index) => <li key={index}>Break / gap: {window.fromTime} – {window.toTime}{window.requiresPunches ? " · Clock OUT and back IN required" : ""}</li>)}</ul>}
          {day.phase === "future" || day.phase === "in-progress" ? <p>Planned duration: {duration(day.scheduledMinutes)}. This is not completed work.</p> : <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4"><div><dt className="text-muted-foreground">Recorded work</dt><dd>{duration(day.workedMinutes)}</dd></div><div><dt className="text-muted-foreground">Late</dt><dd>{duration(day.lateMinutes)}</dd></div><div><dt className="text-muted-foreground">Undertime</dt><dd>{duration(day.undertimeMinutes)}</dd></div><div><dt className="text-muted-foreground">Recorded overtime</dt><dd>{duration(day.overtimeMinutes)}</dd></div></dl>}
          {day.overtimeMinutes > 0 && <p>{day.overtimeApprovalOnFile ? "An administrator's day approval is on file. Approved and paid quantities may differ." : "No day overtime approval is on file. Ask Payroll Admin to review the evidence; this does not determine entitlement."}</p>}
          {day.hasTimeOverride && <p>These time totals include a saved administrator day adjustment. The punch evidence remains visible below.</p>}
          {day.leaveCoverage === "partial-day" && <p>Approved partial-day leave is on file. Review attendance for the remaining scheduled time; this view does not determine absence, leave entitlement or pay.</p>}
          {!!day.findings.length && <ul className="list-disc space-y-1 pl-5">{day.findings.map(finding => <li key={finding.code}>{finding.label}{finding.needsAction ? " · Needs action" : ""}</li>)}</ul>}
          <div><h3 className="font-semibold">Punch evidence · Philippine time</h3><p className="mb-2 text-xs text-muted-foreground">Effective punches are distinguished from retained history. Source notes and financial details are omitted.</p>{day.punches.length ? <ul className="divide-y rounded border">{day.punches.map(punch => <li key={punch.id} className="flex flex-wrap justify-between gap-2 p-2"><span>{punch.type} · {time(punch.at)}</span><span>{punch.included ? "Effective" : punch.state === "resolved" ? "Retained correction history" : punch.state === "voided" ? "Voided history" : punch.state === "excluded" ? "Excluded history" : "Pending review"}</span></li>)}</ul> : <p>No punch evidence received for this workday.</p>}</div>
          {day.correctedAt && <p>Last saved correction: {time(day.correctedAt)}.</p>}
          {day.needsAction && <p className="rounded bg-amber-50 p-3 text-amber-950">Share the employee, work date and observed issue with Payroll Admin for review. This view does not change attendance or approve payroll.</p>}
        </div></details>)}</div></section>)}</div>}
  </div>;
}
