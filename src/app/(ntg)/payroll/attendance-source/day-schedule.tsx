"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { confirmScheduleDays, getScheduleDayRepair, getScheduleRequestReceipt } from "@/app/actions/scheduleWorkspaceAction";
import type { ScheduleCell, ScheduleDayRepair, SchedulePeriodCommand, ScheduleReceipt, ScheduleSnapshot } from "@/lib/scheduling/workspace-types";
import { applyScheduleChanges } from "@/lib/scheduling/model";
import { formatWorkday } from "@/lib/payroll/dateDisplay";
import { generateUUID } from "@/lib/uuid";

const button="min-h-11 rounded border px-3 py-2 text-sm font-semibold disabled:opacity-50";
function Details({snapshot}:{snapshot:ScheduleSnapshot}){return snapshot.kind!=="shift"?null:<p className="text-xs">{snapshot.hoursPerDay} scheduled hours · {snapshot.breakMinutes} min unpaid break · {snapshot.paidBreakMinutes} min paid break{snapshot.breaks.length>0&&<span> · {snapshot.breaks.map(item=>`${item.label} ${item.fromTime}–${item.toTime}`).join("; ")}</span>}</p>;}
export function DaySchedule({employeeId,day,periodId,label,expanded,onSaved}:{employeeId:string;day:string;periodId?:string;label?:string;expanded?:boolean;onSaved:()=>Promise<void>}) {
 const searchParams=useSearchParams();
 const [context,setContext]=useState<ScheduleDayRepair|null>(null),[selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[saved,setSaved]=useState(false),[uncertain,setUncertain]=useState(false);
 const [contextStale,setContextStale]=useState(false);
 const [custom,setCustom]=useState(false),[start,setStart]=useState(""),[end,setEnd]=useState("");
 const pending=useRef(false),command=useRef<SchedulePeriodCommand|null>(null),errorRef=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
 async function load(){if(pending.current)return;pending.current=true;setBusy(true);setError("");try{const next=await getScheduleDayRepair({employeeId,day,periodId});setContext(next);setContextStale(false);setSaved(false);command.current=null;setUncertain(false);}catch(cause){setError(cause instanceof Error?cause.message:"The schedule context could not load. Retry here.");}finally{pending.current=false;setBusy(false);}}
 async function refresh(afterSave=false){
  if(!afterSave&&pending.current)return;
  if(!afterSave){pending.current=true;setBusy(true);}
  setContextStale(true);setError("");
  try{
   const [schedule,employee]=await Promise.allSettled([getScheduleDayRepair({employeeId,day,periodId:context?.periodId}),Promise.resolve().then(onSaved)]);
   if(schedule.status==="fulfilled"){setContext(schedule.value);setContextStale(false);setSelected("");setCustom(false);setStart("");setEnd("");}
   if(schedule.status==="rejected")setError(employee.status==="rejected"?"Schedule saved. The date schedule and employee view could not refresh; retry these views without saving again.":"Schedule saved. The current date schedule could not refresh; retry before making another change. Your saved receipt is retained.");
   else if(employee.status==="rejected")setError("Schedule saved. The employee view could not refresh; retry this view without saving again.");
  }finally{if(!afterSave){pending.current=false;setBusy(false);}}
 }
 async function complete(receipt:ScheduleReceipt){command.current=null;setSaved(true);setUncertain(false);setMessage(`${receipt.message} DTR summaries updated: ${receipt.summariesRebuilt??0}. Payroll is unchanged. Other employee/day drafts are retained.`);await refresh(true);}
 async function save(){
  if(pending.current||contextStale||!context||!selected)return;pending.current=true;setBusy(true);setError("");
  const input=command.current??{requestId:generateUUID(),departmentId:context.departmentId,periodId:context.periodId,sourceDigest:context.sourceDigest,expectedDraftId:context.expectedDraftId,expectedDraftRevision:context.expectedDraftRevision,changes:[{employeeId,day,value:selected,...(custom?{customTimes:{start,end}}:{})}]};
  try{
   if(command.current){const receipt=await getScheduleRequestReceipt(input.requestId);if(receipt){await complete(receipt);return;}}
   command.current=input;setMessage("Saving this employee’s date schedule and updating attendance…");
   const result=await confirmScheduleDays(input);
   if(result.ok){await complete(result.receipt);return;}
   const receipt=await getScheduleRequestReceipt(input.requestId);if(receipt){await complete(receipt);return;}
   command.current=null;setUncertain(false);setMessage("");setError(result.error);
  }catch{
   setUncertain(true);
   try{const receipt=await getScheduleRequestReceipt(input.requestId);if(receipt)await complete(receipt);else setError("The response was interrupted. No receipt is available yet; retry this same request safely. Your selection is retained.");}
   catch{setError("The response and receipt check were interrupted. Retry this same request; its saved status is checked before any write.");}
  }finally{pending.current=false;setBusy(false);}
 }
 let proposed:ScheduleCell|null=null,previewError="";
 if(context&&selected)try{proposed=applyScheduleChanges([context.cell],[{employeeId,day,value:selected,...(custom?{customTimes:{start,end}}:{})}],new Map(context.shifts.map(shift=>[String(shift.id),shift.snapshot])))[0];}catch(cause){previewError=cause instanceof Error?cause.message:"The selected schedule is no longer available. Choose an available schedule before confirming.";}
 function editTimes(which:"start"|"end",value:string){if(which==="start")setStart(value);else setEnd(value);setSaved(false);command.current=null;setMessage("");}
 return <details open={expanded||undefined} className="my-2 min-w-0 rounded border p-2" onToggle={event=>{if(event.currentTarget.open&&!context&&!busy)void load();}}>
  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{label??`Schedule for ${formatWorkday(day)}`}</summary>
  <p className="text-xs">This action changes only this employee and date. Other branch-period draft changes stay saved. Attendance facts can be confirmed independently.</p>
  <Link className="my-2 inline-flex min-h-11 items-center text-sm font-semibold underline" href={`/schedules?${new URLSearchParams({view:"period",employeeId,day,group:searchParams?.get("group")==="Monthly"?"Monthly":"Daily",...(context?.periodId||periodId?{periodId:context?.periodId??periodId!}:{}),...(context?.departmentId?{departmentId:String(context.departmentId)}:{})})}`}>Open period schedule and history</Link>
  {context&&<><p className="text-sm">{contextStale?"Previously loaded":"Current"}: {context.cell.label}</p><Details snapshot={context.cell.snapshot}/>{context.pendingDraftCell&&<p className="mt-2 rounded bg-amber-50 p-2 text-xs">A saved period draft contains this date: {context.pendingDraftCell.label}. Only your explicit choice below will be confirmed; other draft dates are retained.</p>}<label className="block py-2 text-sm">Schedule<select aria-label={`Schedule for ${formatWorkday(day)}`} value={selected} disabled={busy||uncertain||contextStale} onChange={event=>{setSelected(event.target.value);setSaved(false);command.current=null;setMessage("");}} className="mt-1 min-h-11 w-full min-w-0 rounded border p-2"><option value="">Choose the actual schedule</option>{context.cell.snapshot.kind==="shift"&&<option value="captured">Current schedule</option>}<option value="rest">Rest day</option><option value="unconfigured">Unconfigured</option><option value="default">Restore captured period default</option><option value="latest-default">Use latest weekly default</option>{context.shifts.map(shift=><option key={shift.id} value={shift.id}>{shift.label}</option>)}</select></label><fieldset disabled={busy||uncertain||contextStale} className="my-2 space-y-2"><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={custom} onChange={event=>{setCustom(event.target.checked);setSaved(false);command.current=null;setMessage("");if(event.target.checked){const base=context.shifts.find(shift=>String(shift.id)===selected)?.snapshot??context.cell.snapshot;setStart(base.checkInTime?.slice(0,5)??"");setEnd(base.checkOutTime?.slice(0,5)??"");if(!selected)setSelected("captured");}}}/>Adjust start/end for this date</label>{custom&&<><div className="grid min-w-0 grid-cols-2 gap-2"><label className="min-w-0 text-sm">Start<input type="time" className="mt-1 min-h-11 w-full min-w-0 rounded border bg-background p-2" value={start} onChange={event=>editTimes("start",event.target.value)}/></label><label className="min-w-0 text-sm">End<input type="time" className="mt-1 min-h-11 w-full min-w-0 rounded border bg-background p-2" value={end} onChange={event=>editTimes("end",event.target.value)}/></label></div><p className="text-xs">Uses existing template breaks. An end earlier than start finishes the next day. Choose a different shift to change breaks.</p></>}</fieldset>{previewError&&<p role="alert" className="text-sm text-red-800">{previewError}</p>}{proposed&&<div className="my-2 rounded border border-blue-300 p-2 text-sm"><strong>Review {formatWorkday(day)}</strong><p>{context.cell.label} → {proposed.label}</p><Details snapshot={proposed.snapshot}/><p className="mt-1 text-xs">Confirming applies exactly this employee/day schedule. Notes and evidence entry are not required. Payroll is not posted.</p></div>}<button type="button" disabled={!selected||busy||saved||contextStale||!!previewError} onClick={()=>void save()} className={button}>{busy?(saved?"Refreshing views…":"Saving schedule…"):saved?"Schedule saved":uncertain?"Check status and retry same request":"Confirm this date’s schedule"}</button></>}
  {busy&&!context&&<p role="status" className="text-sm">Loading this date’s schedule…</p>}{message&&<p role="status" className="mt-2 break-words text-sm">{message}</p>}
  {error&&<div className="mt-2 rounded border border-red-400 bg-red-50 p-2"><p ref={errorRef} tabIndex={-1} role="alert" className="break-words text-sm">{error}</p>{saved?<button className={button} disabled={busy} onClick={()=>void refresh()}>Refresh this employee only</button>:!uncertain&&<button className={button} disabled={busy} onClick={()=>void load()}>Reload date for fresh review</button>}</div>}
 </details>;
}
