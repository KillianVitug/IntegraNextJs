"use client";
import { useState } from "react";
import { attendanceScheduleOptionsAction } from "@/app/actions/attendanceWorkbenchAction";
import { listEmployeeShiftAssignments, saveEmployeeShiftAssignment } from "@/app/actions/shiftAssignmentAction";

export function DaySchedule({employeeId,day,onSaved}:{employeeId:string;day:string;onSaved:()=>Promise<void>}) {
 const [options,setOptions]=useState<Awaited<ReturnType<typeof attendanceScheduleOptionsAction>>>([]);
 const [selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function save(){setBusy(true);setMessage("");try{
  const assignments=await listEmployeeShiftAssignments(employeeId);
  const existing=assignments.find(a=>a.effectiveFrom===day&&a.effectiveTo===day);
  await saveEmployeeShiftAssignment({id:existing?.id,employeeId,shiftTableId:Number(selected),effectiveFrom:day,effectiveTo:day,graceMinutes:existing?.graceMinutes??0,restDay:existing?.restDay??null,isFlexible:existing?.isFlexible??false});
  setMessage("Schedule saved for this date. Review refreshed calculation context.");await onSaved();
 }catch(error){setMessage(error instanceof Error?error.message:"Schedule could not be saved. Your draft is retained.");}finally{setBusy(false);}}
 return <details className="my-2 min-w-0 rounded border p-2" onToggle={event=>{if(event.currentTarget.open&&!options.length)void attendanceScheduleOptionsAction().then(setOptions).catch(()=>setMessage("Could not load schedules. Retry by reopening this section."));}}>
  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Schedule for {day}</summary>
  <p className="text-xs">Choose an existing schedule for this employee and date. Attendance facts can be approved independently.</p>
  <label className="block py-2 text-sm">Schedule<select aria-label={`Schedule for ${day}`} value={selected} onChange={e=>setSelected(e.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded border p-2"><option value="">Select schedule</option>{options.map(o=><option key={o.id} value={o.id}>{o.code} · {o.start}–{o.end} · {o.name}</option>)}</select></label>
  <button type="button" disabled={!selected||busy} onClick={()=>void save()} className="min-h-11 rounded border px-3 text-sm font-semibold disabled:opacity-50">{busy?"Saving schedule…":"Confirm this date’s schedule"}</button>
  {message&&<p role="status" className="mt-2 break-words text-sm">{message}</p>}
 </details>;
}
