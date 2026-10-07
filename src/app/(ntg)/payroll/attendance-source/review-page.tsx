"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { payrollRead } from "@/lib/payroll/readClient";
import { attendancePeriodUrl, selectAttendanceSourcePeriod, type AttendanceSourcePeriod } from "@/lib/payroll/attendanceSourcePeriods";
import type { WorkBoard } from "@/lib/payroll/attendanceWorkbenchModel";
import type { MatchBoard, MatchMutation, WorkflowResult } from "@/lib/payroll/attendanceMatching";
import type { DuplicateBoard } from "@/lib/payroll/attendanceDuplicateModel";
import type { AttendanceReadiness } from "@/lib/payroll/attendanceResolutionModel";
import { updateAttendanceMatchingAction, attendanceMatchingHistoryAction } from "@/app/actions/attendanceSourceAction";
import { AttendanceWorkbench } from "./workbench";
import { EmployeeMatching } from "./employee-matching";
import { DuplicateReview } from "./duplicate-review";
import { AttendanceReadinessCard, AttendanceReview } from "./attendance-review";

const button="min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50";
function useView<T>(view:string,periodId:string,enabled:boolean,revision=0) {
 const [data,setData]=useState<T|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0);
 const retry=useCallback(()=>setAttempt(n=>n+1),[]);
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController();setLoading(true);setError("");
  payrollRead<T>(view,{periodId},controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Unable to load this view.");}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[view,periodId,enabled,revision,attempt]);
 return {data,error,loading,retry};
}
function ReadStatus({error,loading,retry}:{error:string;loading:boolean;retry:()=>void}) {
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(error)ref.current?.focus({preventScroll:true});},[error]);
 return error?<div ref={ref} role="alert" tabIndex={-1} className="my-3 rounded border border-red-400 bg-red-50 p-3"><p>{error}</p><button className={button+" mt-2"} onClick={retry}>Retry loading this view</button></div>:loading?<p role="status" className="my-3 text-sm">Loading this view… You can continue using the other sections.</p>:null;
}
function SecondaryTools({periodId,onChanged}:{periodId:string;onChanged:()=>void}) {
 const [open,setOpen]=useState({matching:false,duplicates:false,source:false,history:false}),[saving,setSaving]=useState(false);
 const history=useView<{id:string;state:string;startedAt:string;counts:unknown;error:string|null}[]>("sync-history",periodId,open.history);
 const matching=useView<MatchBoard>("matching",periodId,open.matching),duplicates=useView<DuplicateBoard>("duplicates",periodId,open.duplicates),source=useView<AttendanceReadiness>("readiness",periodId,open.source);
 useEffect(()=>{const reveal=()=>{if(location.hash==="#employee-matching")setOpen(o=>({...o,matching:true}));if(location.hash==="#obvious-duplicates")setOpen(o=>({...o,duplicates:true}));};reveal();window.addEventListener("hashchange",reveal);return()=>window.removeEventListener("hashchange",reveal);},[]);
 async function saveMatch(request:MatchMutation):Promise<WorkflowResult>{setSaving(true);try{const result=await updateAttendanceMatchingAction(request);if(result.ok){matching.retry();onChanged();}return result;}catch{return {ok:false,error:"Unable to confirm the match. Your choices are retained. Check history before retrying."};}finally{setSaving(false);}}
 return <div className="space-y-3">
  <details id="employee-matching" open={open.matching} onToggle={e=>{const expanded=e.currentTarget.open;setOpen(o=>({...o,matching:expanded}));}} className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer font-semibold">Employee matching</summary><ReadStatus {...matching}/>{matching.data&&<EmployeeMatching board={matching.data} busy={saving} mutate={saveMatch} loadHistory={attendanceMatchingHistoryAction}/>}</details>
  <details id="duplicate-review-tools" open={open.duplicates} onToggle={e=>{const expanded=e.currentTarget.open;setOpen(o=>({...o,duplicates:expanded}));}} className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer font-semibold">Duplicate punch review</summary><ReadStatus {...duplicates}/>{duplicates.data&&<DuplicateReview key={JSON.stringify(duplicates.data)} periodId={periodId} initial={duplicates.data} refresh={()=>{duplicates.retry();onChanged();}}/>}</details>
  <details open={open.source} onToggle={e=>{const expanded=e.currentTarget.open;setOpen(o=>({...o,source:expanded}));}} className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer font-semibold">Source warnings and earlier proposals</summary><ReadStatus {...source}/>{source.data&&<><AttendanceReadinessCard data={source.data}/><details className="my-3 min-w-0"><summary className="min-h-11 cursor-pointer font-semibold">All records for this period</summary><p className="text-sm">Includes neighboring days. Open Employee matching to review identity assignments.</p><div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>Captured (Manila)</th><th>Attendance person</th><th>Punch</th><th>Review</th></tr></thead><tbody>{source.data.people.flatMap(p=>p.records).map(p=><tr key={p.eventId} className="border-t"><td className="p-2">{new Date(p.capturedAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"})}</td><td className="p-2">{p.employeeId} · {p.employeeName}</td><td className="p-2">{p.type} · {p.branchId} · {p.status}</td><td className="p-2">{p.clockFlag?"Clock review. ":""}{p.reviewResolved?"Source review resolved":p.reviewFlags.join(", ")}</td></tr>)}</tbody></table></div></details><AttendanceReview anchorId="attendance-review-legacy" data={source.data} refresh={()=>{source.retry();onChanged();}}/></>}</details>
  <details open={open.history} onToggle={e=>{const expanded=e.currentTarget.open;setOpen(o=>({...o,history:expanded}));}} className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer font-semibold">Sync history</summary><ReadStatus {...history}/><ul className="divide-y">{history.data?.map(r=><li key={r.id} className="py-3 text-sm"><strong>{r.state}</strong> · {new Date(r.startedAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"})}<p className="mt-1 break-words">{r.error??JSON.stringify(r.counts)}</p></li>)}</ul></details>
 </div>;
}
export function AttendanceReviewPage({periods,year,periodId,today}:{periods:AttendanceSourcePeriod[];year:number;periodId:string;today:string}) {
 const router=useRouter(),[changing,startChange]=useTransition(),[revision,setRevision]=useState(0);
 const board=useView<WorkBoard>("workbench",periodId,!!periodId,revision);
 const selected=selectAttendanceSourcePeriod(periods,{year:String(year),periodId},today);
 const years=[...new Set([year,...periods.map(p=>p.year)])].sort((a,b)=>b-a);
 return <main style={{colorScheme:"light"}} className="mx-auto min-w-0 max-w-6xl space-y-4 bg-white p-3 text-slate-900 sm:p-6">
  <header><Link className="inline-flex min-h-11 items-center text-sm text-blue-700 underline" href={attendancePeriodUrl("/payroll",year,periodId)}>Back to payroll</Link><h1 className="text-2xl font-semibold">Attendance review & sync</h1><p className="mt-2 text-sm">Review employee days, finish the selected changes, then refresh DTR and return to payroll. Missing attendance does not block payroll.</p></header>
  <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
   <label className="text-sm">Payroll year<select className="mt-1 min-h-11 w-full rounded border p-2" value={year} disabled={changing} onChange={e=>{const next=selectAttendanceSourcePeriod(periods,{year:e.target.value},today);startChange(()=>router.replace(attendancePeriodUrl('/payroll/attendance-source',next.year,next.periodId),{scroll:false}));}}>{years.map(y=><option key={y}>{y}</option>)}</select></label>
   <label className="min-w-0 text-sm">Payroll period<select className="mt-1 min-h-11 w-full rounded border p-2" value={periodId} disabled={changing} onChange={e=>startChange(()=>router.replace(attendancePeriodUrl('/payroll/attendance-source',year,e.target.value),{scroll:false}))}>{selected.periods.map(p=><option key={p.id} value={p.id}>{p.code} · {p.startDate} – {p.endDate}</option>)}</select></label>
  </div>
  {changing&&<p role="status">Opening selected period…</p>}
  <ReadStatus {...board}/>{board.data&&<AttendanceWorkbench initial={board.data}/>}
  {!periodId&&<p>Select a payroll period to begin.</p>}
  {periodId&&<SecondaryTools periodId={periodId} onChanged={()=>setRevision(n=>n+1)}/>}
 </main>;
}
