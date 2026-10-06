"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getMonthlyPayrollSettingsAction, saveMonthlyPayrollSettingsAction, payrollGroupHistoryAction } from "@/app/actions/payrollGroupAction";
import type { PayrollGroup } from "@/lib/payroll/payrollGroupModel";

export function PayrollGroups({periodId,year,group}:{periodId:string;year:number;group:PayrollGroup}) {
 const [history,setHistory]=useState<Awaited<ReturnType<typeof payrollGroupHistoryAction>>>([]);
 useEffect(()=>{void payrollGroupHistoryAction(periodId).then(setHistory);},[periodId]);
 const [data,setData]=useState<Awaited<ReturnType<typeof getMonthlyPayrollSettingsAction>>|null>(null),[selected,setSelected]=useState<string[]>([]),[half,setHalf]=useState<"A"|"B">("B"),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{if(group==="Monthly")void getMonthlyPayrollSettingsAction(periodId).then(setData).catch(e=>setMessage(e instanceof Error?e.message:"Unable to load payout settings."));},[periodId,group]);
 async function save(){setBusy(true);try{const r=await saveMonthlyPayrollSettingsAction(periodId,selected,half);setMessage(r.ok?r.data:r.error);if(r.ok){setData(await getMonthlyPayrollSettingsAction(periodId));setSelected([]);}}catch(e){setMessage(e instanceof Error?e.message:"Unable to save payout settings. Your selections are retained.");}finally{setBusy(false);}}
 return <section aria-label="Payroll groups" className="m-3 min-w-0 space-y-3 rounded-xl border bg-white p-3 sm:m-6">
  <nav className="flex flex-wrap gap-2" aria-label="Payroll group">{(["Daily","Monthly"] as const).map(value=><Link key={value} aria-current={group===value?"page":undefined} className={`flex min-h-11 items-center rounded-lg border px-3 text-sm font-semibold ${group===value?"bg-blue-700 text-white":""}`} href={`/payroll?year=${year}&periodId=${periodId}&group=${value}`}>{value==="Daily"?"Daily payroll":"Monthly salary"}</Link>)}</nav>
  <p className="text-sm">{group==="Daily"?"Pay recorded work and approved earnings. No work and no other earnings means ₱0; deductions and loans stay unpaid.":"Pay full monthly salary once, in the chosen half, with whole-month deductions. Missing phone logs do not reduce fixed salary."}</p>
  {group==="Monthly"&&data&&<details><summary className="flex min-h-11 cursor-pointer items-center font-semibold">Payout settings · {data.month} · {data.employees.filter(e=>e.half===data.cycle).length} scheduled this half</summary>
   {!data.installed&&<p role="status" className="text-sm text-amber-900">Payout settings are shown with the second-half default. Saving and monthly computation require the payroll-group migration.</p>}
   <div className="flex flex-wrap items-center gap-2 py-2"><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={data.employees.length>0&&selected.length===data.employees.length} onChange={e=>setSelected(e.target.checked?data.employees.map(x=>x.id):[])}/>Select all monthly employees</label><label>Payout half<select className="ml-2 min-h-11 rounded border p-2" value={half} onChange={e=>setHalf(e.target.value as "A"|"B")}><option value="A">First half</option><option value="B">Second half</option></select></label><button disabled={!data.installed||!selected.length||busy} onClick={()=>void save()} className="min-h-11 rounded border px-3 disabled:opacity-50">Save for {selected.length} employees</button></div>
   <div className="max-h-80 overflow-auto">{data.employees.map(e=><label key={e.id} className="flex min-h-11 items-center gap-2 border-t py-2 text-sm"><input type="checkbox" checked={selected.includes(e.id)} onChange={event=>setSelected(event.target.checked?[...selected,e.id]:selected.filter(id=>id!==e.id))}/><span>{e.no} · {e.first} {e.last}<span className="block text-xs">{e.half==="A"?"First half":"Second half"} · {e.half===data.cycle?"Scheduled this half":"Not scheduled this half"}</span></span></label>)}</div>
  </details>}
  {!!history.length&&<details><summary className="flex min-h-11 cursor-pointer items-center">Payroll run history · includes legacy runs</summary><div className="flex flex-wrap gap-2">{history.map(run=><Link key={run.id} className="flex min-h-11 items-center rounded border px-3 text-sm" href={`/payroll?year=${year}&periodId=${periodId}&group=${run.group==="Monthly"?"Monthly":"Daily"}&runId=${run.id}`}>{run.group} · Run {run.number} · {run.status}</Link>)}</div></details>}
  {message&&<p role="status" className="break-words text-sm">{message}</p>}
 </section>;
}
