"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { syncAttendanceSourceAction, saveAttendanceSourceMappingAction, refreshAttendanceSourceSummariesAction } from "@/app/actions/attendanceSourceAction";
import type { SourcePunch } from "@/lib/payroll/attendanceSourceClient";
import type { AttendancePerson, EmployeeMatch, MatchSaveResult, PayrollMatchEmployee } from "@/lib/payroll/attendanceMatching";
import { attendancePeriodUrl, selectAttendanceSourcePeriod, type AttendanceSourcePeriod } from "@/lib/payroll/attendanceSourcePeriods";
import { EmployeeMatching } from "./employee-matching";

type Props = {
  initialYear: number; initialPeriodId: string; today: string; inbox: SourcePunch[]; people: AttendancePerson[];
  periods: AttendanceSourcePeriod[]; employees: PayrollMatchEmployee[]; mappings: EmployeeMatch[];
  runs: { id: string; state: string; startedAt: string; counts: string; error: string | null }[];
};
const controlClass = "mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-900 disabled:opacity-60";
const buttonClass = "min-h-11 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

export function AttendanceSourcePanel(props: Props) {
  const router = useRouter();
  const [changingPeriod, startPeriodChange] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const busy = saving || changingPeriod || refreshing;
  const period = props.initialPeriodId, year = props.initialYear;
  const periods = selectAttendanceSourcePeriod(props.periods, { year: String(year), periodId: period }, props.today).periods;
  const years = [...new Set([year, ...props.periods.map(p => p.year)])].sort((a, b) => b - a);
  const periodLabel = periods.find(item => item.id === period)?.code ?? null;
  function changePeriod(nextYear: number, nextPeriod: string) {
    startPeriodChange(() => router.replace(attendancePeriodUrl("/payroll/attendance-source", nextYear, nextPeriod), { scroll: false }));
  }
  async function perform(fn: () => Promise<MatchSaveResult>) {
    setSaving(true); setMessage("");
    try { const result = await fn(); setMessage(result.ok ? result.data : result.error); startRefresh(() => router.refresh()); }
    catch { setMessage("Unable to complete this request. Refresh the page and sign in again if needed."); }
    finally { setSaving(false); }
  }
  async function saveMatch(sourceId: string, employeeId: string, reason: string): Promise<MatchSaveResult> {
    setSaving(true); setMessage("");
    try {
      const result = await saveAttendanceSourceMappingAction(sourceId, employeeId, reason);
      if (result.ok) startRefresh(() => router.refresh());
      return result;
    } catch { return { ok: false, error: "Unable to save the match. Your choices are still here. Try again, or sign in again if your session has expired." }; }
    finally { setSaving(false); }
  }
  const syncPeriod = () => perform(() => syncAttendanceSourceAction(period));
  return <main className="mx-auto min-w-0 max-w-6xl space-y-6 p-4 text-slate-900 sm:p-6">
    <header><Link className="inline-flex min-h-10 items-center text-sm text-blue-700 underline" href={attendancePeriodUrl("/payroll", year, period)}>Back to payroll</Link><h1 className="mt-2 text-2xl font-semibold">Attendance connection</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Match attendance people to their Integra employee records, then sync the affected payroll periods and review the DTR.</p></header>

    <EmployeeMatching people={props.people} employees={props.employees} mappings={props.mappings} busy={busy} saveMatch={saveMatch} syncPeriod={syncPeriod} periodLabel={periodLabel} />

    <section aria-labelledby="reconcile-title" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div><h2 id="reconcile-title" className="text-lg font-semibold">Update a payroll period</h2><p className="mt-1 text-sm leading-6 text-slate-600">After saving matches, sync each affected period to apply them. Sync also picks up late uploads, voids and identity corrections.</p></div>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <label className="block text-sm font-medium">Payroll year<select className={controlClass} value={year} disabled={busy} onChange={e => { const next = selectAttendanceSourcePeriod(props.periods, { year: e.target.value }, props.today); changePeriod(next.year, next.periodId); }}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select></label>
        <label className="block min-w-0 text-sm font-medium">Payroll period<select className={controlClass} value={period} onChange={e => changePeriod(year, e.target.value)} disabled={busy || !periods.length}>{!periods.length && <option value="">No periods for this year</option>}{periods.map(p => <option key={p.id} value={p.id}>{p.code} · {p.startDate} – {p.endDate}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap gap-3"><button className={`${buttonClass} bg-blue-700 text-white hover:bg-blue-800`} disabled={busy || !period} onClick={syncPeriod}>1. Sync attendance now</button><button className={`${buttonClass} border border-slate-300`} disabled={busy || !period} onClick={() => perform(() => refreshAttendanceSourceSummariesAction(period))}>2. Refresh DTR summaries</button><Link className={`${buttonClass} inline-flex items-center text-blue-700 underline`} href={attendancePeriodUrl("/payroll", year, period)}>3. Review in payroll</Link></div>
      <p className="text-sm leading-6 text-slate-600">Review the DTR before recomputing payroll. Unmatched people and unresolved attendance warnings remain withheld. Closed periods and posted payroll stay unchanged; late changes appear in sync history.</p>
      <p role="status" className="break-words text-sm font-medium text-blue-800">{busy ? "Working…" : message}</p>
    </section>

    <details className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
      <summary className="min-h-8 cursor-pointer font-semibold">Other attendance issues</summary>
      <ul className="mt-3 list-disc space-y-2 pl-5 leading-6 text-slate-600"><li>Employee match needed: confirm both identities above, save, then sync again.</li><li>Source review or VOID: review the evidence in the attendance dashboard, then sync. Do not invent replacement punches.</li><li>Wrong clock or missing boundary partner: ask the branch supervisor for verified evidence. A source review alone does not clear a clock flag.</li><li>All punches cleared: payroll needs an approved absence, replacement-evidence or exclusion decision. Keep this period blocked until the policy and implementation are accepted.</li><li>Overlapping file imports: resolve these before switching an employee/date to this source.</li><li>Late change after posting: preserve the posted run and arrange a linked adjustment with payroll.</li></ul>
    </details>
    <details className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 text-sm">
      <summary className="min-h-8 cursor-pointer font-semibold">Recent attendance records</summary><p className="my-3 text-slate-600">Latest 500 punches across synced periods. The employee matching list above includes people from all stored records.</p>
      <div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>Captured (Manila)</th><th>Attendance person</th><th>Punch</th><th>Review</th></tr></thead><tbody>{props.inbox.map(p => <tr key={p.eventId} className="border-t"><td className="p-2">{new Date(p.capturedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td><td className="p-2">{p.employeeId} · {p.employeeName}</td><td className="p-2">{p.type} · {p.branchId} · {p.status}</td><td className="p-2">{!props.mappings.some(m => m.sourceId === p.employeeId && props.employees.some(e => e.id === m.employeeId)) ? "Employee match needed. " : ""}{p.clockFlag ? "Clock review. " : ""}{p.reviewResolved ? "Source review resolved" : p.reviewFlags.join(", ")}</td></tr>)}</tbody></table></div>
    </details>
    <details className="rounded-xl border border-slate-200 bg-white p-5 text-sm"><summary className="min-h-8 cursor-pointer font-semibold">Sync history</summary><ul className="mt-2 divide-y">{props.runs.map(r => <li key={r.id} className="py-3"><strong>{r.state}</strong> · {new Date(r.startedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}<p className="mt-1 break-words text-slate-600">{r.error ?? r.counts}</p></li>)}</ul></details>
  </main>;
}
