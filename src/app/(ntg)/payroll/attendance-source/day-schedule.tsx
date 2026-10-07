"use client";
import { useEffect, useRef, useState } from "react";
import { attendanceScheduleOptionsAction } from "@/app/actions/attendanceWorkbenchAction";
import { listEmployeeShiftAssignments, saveEmployeeShiftAssignment } from "@/app/actions/shiftAssignmentAction";

export function DaySchedule({employeeId,day,onSaved}:{employeeId:string;day:string;onSaved:()=>Promise<void>}) {
 const [options,setOptions]=useState<Awaited<ReturnType<typeof attendanceScheduleOptionsAction>>>([]);
 const [selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[saved,setSaved]=useState(false);
 const pending=useRef(false),errorRef=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(error)errorRef.current?.focus({preventScroll:true});},[error]);
 async function refresh(){try{await onSaved();setError("");setMessage("Schedule saved for this date. Review refreshed calculation context.");}catch{setError("The schedule was saved, but the employee view could not refresh. Retry this view without saving again.");}}
 async function save(){if(pending.current)return;pending.current=true;setBusy(true);setError("");setMessage("Saving this date’s schedule and updating DTR. Your other selections are retained.");try{
  const assignments=await listEmployeeShiftAssignments(employeeId);
  const existing=assignments.find(a=>a.effectiveFrom===day&&a.effectiveTo===day);
  await saveEmployeeShiftAssignment({id:existing?.id,employeeId,shiftTableId:Number(selected),effectiveFrom:day,effectiveTo:day,graceMinutes:existing?.graceMinutes??0,restDay:existing?.restDay??null,isFlexible:existing?.isFlexible??false});
  setSaved(true);await refresh();
 }catch(error){setMessage("");setError(error instanceof Error?error.message:"Schedule could not be confirmed. Your selection is retained.");}finally{pending.current=false;setBusy(false);}}
 return <details className="my-2 min-w-0 rounded border p-2" onToggle={event=>{if(event.currentTarget.open&&!options.length)void attendanceScheduleOptionsAction().then(setOptions).catch(()=>setMessage("Could not load schedules. Retry by reopening this section."));}}>
  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Schedule for {day}</summary>
  <p className="text-xs">Choose an existing schedule for this employee and date. Attendance facts can be approved independently.</p>
  <label className="block py-2 text-sm">Schedule<select aria-label={`Schedule for ${day}`} value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);setSaved(false);}} className="mt-1 min-h-11 w-full min-w-0 rounded border p-2"><option value="">Select schedule</option>{options.map(o=><option key={o.id} value={o.id}>{o.code} · {o.start}–{o.end} · {o.name}</option>)}</select></label>
  <button type="button" disabled={!selected||busy||saved} onClick={()=>void save()} className="min-h-11 rounded border px-3 text-sm font-semibold disabled:opacity-50">{busy?"Saving schedule…":saved?"Schedule saved":"Confirm this date’s schedule"}</button>
  {message&&<p role="status" className="mt-2 break-words text-sm">{message}</p>}
  {error&&<div className="mt-2 rounded border border-red-400 bg-red-50 p-2"><p ref={errorRef} tabIndex={-1} role="alert" className="break-words text-sm">{error}</p>{saved&&<button className="min-h-11 underline" disabled={busy} onClick={()=>void refresh()}>Refresh this employee only</button>}</div>}
 </details>;
}
