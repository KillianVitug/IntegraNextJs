"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, Search, ShieldCheck, UsersRound } from "lucide-react";
import { matchesSearch, matchHint, suggestedEmployees, verificationMethods, verificationReason, type AttendancePerson, type EmployeeMatch, type MatchSaveResult, type PayrollMatchEmployee } from "@/lib/payroll/attendanceMatching";

type Props = {
  people: AttendancePerson[]; employees: PayrollMatchEmployee[]; mappings: EmployeeMatch[]; busy: boolean;
  saveMatch: (sourceId: string, employeeId: string, reason: string) => Promise<MatchSaveResult>;
  syncPeriod: () => void; periodLabel: string | null;
};
const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:opacity-60";
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50";
function dateLabel(date: string) { return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(date)); }

export function EmployeeMatching(props: Props) {
  const [filter, setFilter] = useState<"unmatched" | "matched">("unmatched");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const activeEmployees = new Set(props.employees.map(employee => employee.id));
  const assigned = new Map(props.mappings.map(mapping => [mapping.sourceId, mapping.employeeId]));
  const isMatched = (id: string) => activeEmployees.has(assigned.get(id) ?? "");
  const unmatched = props.people.filter(person => !isMatched(person.sourceId));
  const matched = props.people.filter(person => isMatched(person.sourceId));
  const list = (filter === "unmatched" ? unmatched : matched).filter(person => matchesSearch(search, person.sourceId, ...person.names, ...person.branches));
  const selected = props.people.find(person => person.sourceId === selectedId);
  function selectPerson(id: string) {
    setSelectedId(id);
    requestAnimationFrame(() => { editorHeading.current?.focus({ preventScroll: true }); editorHeading.current?.parentElement?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  }
  return <section aria-labelledby="matching-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-200 p-5 sm:p-6">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><UsersRound size={22} aria-hidden="true" /></span><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Employee matching</p><h2 id="matching-title" className="mt-1 text-xl font-semibold text-slate-900">Who do these attendance records belong to?</h2></div></div>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Choose a person from attendance, then confirm their employee record in Integra. You only need to do this once per attendance ID. Matches apply across payroll periods.</p>
      <ol className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600" aria-label="Matching steps">{["Choose attendance person", "Find Integra employee", "Confirm the match"].map((step, i) => <li key={step} className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{i + 1}</span>{step}</li>)}</ol>
    </div>
    <div className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className={`${selected ? "hidden lg:block" : "block"} min-w-0 border-slate-200 bg-slate-50/60 p-4 lg:border-r`}>
        <div className="flex rounded-lg border border-slate-200 bg-white p-1" role="group" aria-label="People to match">
          {([['unmatched', 'Needs a match', unmatched.length], ['matched', 'Matched', matched.length]] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={filter === value} disabled={props.busy} onClick={() => { setFilter(value); setSelectedId(null); }} className={`min-h-11 flex-1 rounded-md px-2 text-sm font-medium ${filter === value ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label} <span className="ml-1 tabular-nums">{count}</span></button>)}
        </div>
        <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="attendance-person-search">Find an attendance person</label>
        <div className="relative mt-1.5"><Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-slate-400" /><input id="attendance-person-search" className={`${inputClass} pl-9`} placeholder="Name, attendance ID or branch" value={search} onChange={event => setSearch(event.target.value)} disabled={props.busy} /></div>
        <p className="mb-2 mt-4 text-xs text-slate-500">Across all synced payroll periods</p>
        <div className="max-h-[580px] space-y-2 overflow-y-auto pr-1">
          {list.map(person => <button key={person.sourceId} type="button" disabled={props.busy} aria-pressed={selectedId === person.sourceId} onClick={() => selectPerson(person.sourceId)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-60 ${selectedId === person.sourceId ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-300"}`}>
            <div className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-slate-900">{person.names[0] || `Attendance ID ${person.sourceId}`}</span><span className="mt-1 block text-xs text-slate-500">ID {person.sourceId} · {person.punchCount} punch{person.punchCount === 1 ? "" : "es"}</span><span className="mt-1 block break-words text-xs text-slate-500">{person.branches.join(", ") || "No branch recorded"}</span>{person.names.length > 1 && <span className="mt-2 block text-xs font-medium text-amber-800">Multiple recorded names — check identity</span>}{assigned.has(person.sourceId) && !isMatched(person.sourceId) && <span className="mt-2 block text-xs font-medium text-amber-800">Previous employee is no longer active</span>}</div>
            {isMatched(person.sourceId) ? <CheckCircle2 className="shrink-0 text-emerald-600" size={18} aria-hidden="true" /> : <ChevronRight className="shrink-0 text-slate-400" size={18} aria-hidden="true" />}
          </button>)}
          {!list.length && <div className="rounded-xl border border-dashed border-slate-300 p-5 text-sm leading-6 text-slate-600">{search ? "No attendance people match this search. Try a name or attendance ID." : !props.people.length ? "No attendance people yet. Sync a payroll period to bring in records." : filter === "matched" ? "Your confirmed employee matches will appear here." : <><CheckCircle2 className="mb-2 text-emerald-600" size={22} aria-hidden="true" /><strong className="block text-slate-900">Everyone has a match</strong>Other attendance issues may still need review before payroll.</>}</div>}
        </div>
      </div>
      <div className="min-w-0 p-5 sm:p-6">
        {selected ? <>
          <button type="button" disabled={props.busy} onClick={() => setSelectedId(null)} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-blue-700 lg:hidden"><ArrowLeft size={16} aria-hidden="true" />Back to people</button>
          <h3 ref={editorHeading} tabIndex={-1} className="scroll-mt-5 text-lg font-semibold text-slate-900 outline-none">Match {selected.names[0] || `attendance ID ${selected.sourceId}`}</h3>
          <MatchEditor key={selected.sourceId} person={selected} employees={props.employees} currentEmployeeId={assigned.get(selected.sourceId)} busy={props.busy} saveMatch={props.saveMatch} onNext={() => { const next = unmatched.find(person => person.sourceId !== selected.sourceId); if (next) selectPerson(next.sourceId); else { setSelectedId(null); setFilter("unmatched"); } }} syncPeriod={props.syncPeriod} periodLabel={props.periodLabel} />
        </> : <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-5 py-10 text-center"><span className="mb-4 rounded-full bg-blue-50 p-3 text-blue-700"><UsersRound size={26} aria-hidden="true" /></span><h3 className="text-lg font-semibold text-slate-900">Start with a person from attendance</h3><p className="mt-2 max-w-sm text-sm leading-6 text-slate-600">Select a name in the list. Their attendance ID is filled in for you, and you can compare possible employee matches.</p><p className="mt-4 text-xs text-slate-500">No employee is matched automatically.</p></div>}
      </div>
    </div>
  </section>;
}

function MatchEditor({ person, employees, currentEmployeeId, busy, saveMatch, onNext, syncPeriod, periodLabel }: {
  person: AttendancePerson; employees: PayrollMatchEmployee[]; currentEmployeeId?: string; busy: boolean;
  saveMatch: Props["saveMatch"]; onNext: () => void; syncPeriod: () => void; periodLabel: string | null;
}) {
  const [query, setQuery] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MatchSaveResult | null>(null);
  const selected = employees.find(employee => employee.id === employeeId);
  const existing = employees.find(employee => employee.id === currentEmployeeId);
  const suggestions = suggestedEmployees(person, employees);
  const candidates = query.trim() ? employees.filter(employee => matchesSearch(query, employee.name, employee.employeeNo)) : suggestions.map(item => item.employee);
  const reason = verificationReason(method, note);
  const disabled = busy || pending;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !confirmed || !reason || disabled) return;
    setPending(true); setResult(null);
    try { setResult(await saveMatch(person.sourceId, selected.id, reason)); }
    catch { setResult({ ok: false, error: "The match could not be saved. Your choices are still here. Try again." }); }
    finally { setPending(false); }
  }
  if (result?.ok) return <div className="mt-5 space-y-5"><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5" role="status"><CheckCircle2 size={26} className="mb-3 text-emerald-700" aria-hidden="true" /><h4 className="font-semibold text-emerald-950">Employee match saved</h4><p className="mt-2 break-words text-sm text-emerald-900">{person.names[0] || person.sourceId} → {selected?.name} ({selected?.employeeNo})</p><p className="mt-3 text-sm leading-6 text-emerald-900">{result.data}</p></div><div className="flex flex-wrap gap-3"><button type="button" disabled={disabled} className={`${buttonClass} bg-blue-700 text-white hover:bg-blue-800`} onClick={onNext}>Next person<ArrowRight size={16} aria-hidden="true" /></button>{periodLabel && <button type="button" disabled={disabled} className={`${buttonClass} border border-slate-300 bg-white text-slate-700`} onClick={syncPeriod}>Sync {periodLabel}</button>}</div><p className="text-sm leading-6 text-slate-600">After matching, sync each affected period and refresh its DTR summaries. Matching does not clear clock warnings or approve payroll.</p></div>;
  return <form onSubmit={submit} className="mt-4 space-y-6">
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">From attendance</p><p className="mt-1 break-words font-semibold text-slate-900">{person.names.join(" / ") || "Name not recorded"}</p><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Attendance ID</dt><dd className="mt-0.5 break-all font-medium text-slate-900">{person.sourceId}</dd></div><div><dt className="text-slate-500">Latest punch</dt><dd className="mt-0.5 text-slate-900">{dateLabel(person.lastCapturedAt)}</dd></div><div className="col-span-2"><dt className="text-slate-500">Recorded at</dt><dd className="mt-0.5 break-words text-slate-900">{person.branches.join(", ")}</dd></div></dl><p className="mt-3 text-xs text-slate-500">{person.validCount} valid punches · {person.punchCount - person.validCount} voided</p></div>
    {person.names.length > 1 && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">This ID has more than one recorded name. Confirm these names belong to the same person. If they belong to different people, correct the attendance records before saving a match.</p>}
    {currentEmployeeId && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-950"><strong className="block">Current match</strong>{existing ? `${existing.name} · ${existing.employeeNo}` : "The previously selected payroll employee is no longer active. Choose the correct active employee."}<p className="mt-1">Choosing a different employee affects this attendance ID across payroll periods and can make existing payroll stale.</p></div>}
    <fieldset disabled={disabled} className="min-w-0"><legend className="font-semibold text-slate-900">2. Find their Integra employee record</legend><label htmlFor="payroll-match-search" className="mt-3 block text-sm text-slate-600">Search by name or employee number</label><div className="relative mt-1.5"><Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-slate-400" /><input id="payroll-match-search" className={`${inputClass} pl-9`} value={query} onChange={event => setQuery(event.target.value)} placeholder="e.g. Maria Santos or 00404" /></div>
      <p className="mb-2 mt-3 text-xs text-slate-500">{query.trim() ? `${candidates.length} employee${candidates.length === 1 ? "" : "s"} found` : "Possible matches — check the details before choosing"}</p>
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">{candidates.slice(0, 30).map(employee => <label key={employee.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${employeeId === employee.id ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-blue-300"}`}><input type="radio" name="payroll-employee-match" value={employee.id} checked={employeeId === employee.id} onChange={() => { setEmployeeId(employee.id); setConfirmed(false); setResult(null); }} className="mt-1 h-4 w-4 shrink-0 accent-blue-700" /><span className="min-w-0"><span className="block break-words text-sm font-semibold text-slate-900">{employee.name}</span><span className="mt-1 block text-xs text-slate-600">Employee no. {employee.employeeNo}</span>{matchHint(person, employee) && <span className="mt-1 block text-xs leading-5 text-amber-800">{matchHint(person, employee)}</span>}</span></label>)}</div>
      {candidates.length > 30 && <p className="mt-2 text-xs text-slate-500">Showing the first 30. Add more of the name or employee number to narrow the search.</p>}
      {!candidates.length && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm leading-6 text-slate-600">{query.trim() ? "No employee found. Check the spelling or employee number. Ask HR if the person has an active Integra employee record." : "No obvious match yet. Search their name or Integra employee number above."}</p>}
      {selected && !candidates.some(employee => employee.id === selected.id) && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Selected: {selected.name} · {selected.employeeNo}</p>}
    </fieldset>
    {selected ? <fieldset disabled={disabled} className="space-y-3 border-t border-slate-200 pt-5"><legend className="pt-5 font-semibold text-slate-900">3. Confirm this is the same person</legend><div className="grid gap-2 rounded-xl bg-blue-50 p-4 text-sm sm:grid-cols-[1fr_auto_1fr]"><div><span className="block text-xs text-blue-700">Attendance</span><strong className="mt-1 block break-words text-slate-900">{person.names[0] || person.sourceId}</strong><span className="text-xs text-slate-600">ID {person.sourceId}</span></div><ArrowRight size={18} aria-hidden="true" className="self-center text-blue-600" /><div><span className="block text-xs text-blue-700">Integra</span><strong className="mt-1 block break-words text-slate-900">{selected.name}</strong><span className="text-xs text-slate-600">Employee no. {selected.employeeNo}</span></div></div>
      <label className="block text-sm font-medium text-slate-700" htmlFor="match-evidence">How did you check?</label><select id="match-evidence" className={inputClass} value={method} onChange={event => setMethod(event.target.value)} required><option value="">Choose how you verified the person</option>{verificationMethods.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      <label className="block text-sm font-medium text-slate-700" htmlFor="match-note">{method === "other" ? "Describe the evidence" : "Note (optional)"}</label><textarea id="match-note" className={inputClass} value={note} onChange={event => setNote(event.target.value)} placeholder="For example, who confirmed the employee and when" maxLength={300} rows={2} required={method === "other"} />
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm leading-6 text-slate-700"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-blue-700" />I checked that these attendance records belong to {selected.name}.</label>
      {currentEmployeeId && currentEmployeeId !== employeeId && <p className="text-sm font-medium text-amber-900">This replaces the current match. Re-sync affected periods and check the DTR before recomputing payroll.</p>}
      {result && !result.ok && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{result.error}</p>}
      <button type="submit" disabled={disabled || !confirmed || !reason} className={`${buttonClass} w-full bg-blue-700 text-white hover:bg-blue-800 sm:w-auto`}><ShieldCheck size={18} aria-hidden="true" />{pending ? "Saving match…" : currentEmployeeId && currentEmployeeId !== employeeId ? "Confirm and change match" : "Confirm employee match"}</button>
    </fieldset> : <p className="flex items-center gap-2 text-sm text-slate-500"><Check size={16} aria-hidden="true" />Choose an employee above to continue.</p>}
    <details className="border-t border-slate-200 pt-4 text-sm"><summary className="min-h-8 cursor-pointer font-medium text-slate-600">Not sure who this is, or is it a test account?</summary><p className="mt-2 leading-6 text-slate-600">Leave this person unmatched and ask HR or the branch supervisor to check. Review test or incorrectly attributed records in the attendance dashboard. Do not select a different employee just to clear the list.</p><a href="https://attendance-pilot.wecaredrug.workers.dev" target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-10 items-center text-blue-700 underline">Open attendance dashboard</a></details>
  </form>;
}
