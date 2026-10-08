"use client";

import { DaySchedule } from "./day-schedule";
import { useState } from "react";
import type { WorkBoard, WorkChange, WorkDay, WorkDraft, WorkEmployee, WorkKind, WorkRecord } from "@/lib/payroll/attendanceWorkbenchModel";
import { applyBatchNote, draftRecords, changeRecord, draftVersion, localToInstant, sequenceProblems, simulateWork, verificationIssues, workDayRecords, workDate } from "@/lib/payroll/attendanceWorkbenchModel";
import { originalPunchDateTime } from "@/lib/payroll/attendanceResolutionModel";

const button="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-600";
const field="block min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm";
const summary="flex min-h-11 cursor-pointer items-center text-sm font-semibold focus-visible:ring-2 focus-visible:ring-blue-600";
export const changeLabels:Record<WorkKind,string>={Direction:"Correct direction",Time:"Correct date/time",Employee:"Correct this punch’s employee",Void:"Void duplicate / practice punch",Restore:"Restore original punch",Manual:"Add IN/OUT",ConfirmSequence:"Confirm this sequence",NoAttendance:"Confirm no attendance",Exclude:"Exclude competing entry from DTR",Retain:"Retain competing entry in DTR",UndoCapture:"Undo prior capture correction",ReopenDay:"Review affected workday"};

type Props={board:WorkBoard;drafts:WorkDraft[];busy:boolean;onChange:(drafts:WorkDraft[])=>void;editDraft:(employeeId:string,patch:Partial<WorkDraft>)=>void;editChange:(employeeId:string,id:string,patch:Partial<WorkChange>)=>void;onNotice:(text:string)=>void;onAdd?:(employee:string,day:string,kind:WorkKind,record?:WorkRecord)=>void;onScheduleSaved?:()=>Promise<void>};

function ChangeSummary({change,employee,board}:{change:WorkChange;employee?:WorkEmployee;board:WorkBoard}) {
 const record=changeRecord(employee,change),instant=change.at&&localToInstant(change.at);
 const name=(id:string|undefined)=>board.employees.find(p=>p.id===id)?.name??"Employee unavailable";
 if(change.kind==="Manual")return <p className="text-sm">New {change.type??"IN/OUT"} · {instant?originalPunchDateTime(instant):"Actual time required"}</p>;
 if(["ConfirmSequence","NoAttendance","ReopenDay"].includes(change.kind))return <p className="text-sm">{change.kind==="NoAttendance"?"Confirm no effective attendance for this workday":change.kind==="ReopenDay"?"Review the affected employee’s resulting sequence":"Confirm the recorded sequence for this workday"}</p>;
 if(!record)return <p className="text-sm text-amber-900">Selected punch unavailable — refresh and review.</p>;
 let proposed:string;
 switch(change.kind){
  case "Direction":proposed=`${record.type} → ${change.type??"Select direction"} · Time unchanged`;break;
  case "Time":proposed=`Time → ${instant?originalPunchDateTime(instant):"Actual time required"}`;break;
  case "Employee":proposed=`${name(record.employeeId)} → ${name(change.targetEmployeeId)}`;break;
  case "Void":case "Restore":proposed=`${record.status} → ${change.kind==="Void"?"VOID":"VALID"}`;break;
  case "Exclude":case "Retain":proposed=`${record.excluded?"Excluded from DTR":"Included in DTR"} → ${change.kind==="Exclude"?"Excluded from DTR":"Included in DTR"}`;break;
  case "UndoCapture":proposed=[change.type?`${record.type} → ${change.type}`:"",change.at?`Time → ${instant?originalPunchDateTime(instant):"Invalid time"}`:"",change.targetEmployeeId?`${name(record.employeeId)} → ${name(change.targetEmployeeId)}`:"",change.status?`${record.status} → ${change.status}`:""].filter(Boolean).join(" · ");break;
  default:proposed=changeLabels[change.kind];
 }
 return <div className="space-y-1 text-sm"><p>{originalPunchDateTime(record.at)} · {record.type}</p><p className="font-semibold text-blue-800">{proposed}</p></div>;
}

function DayContext({day,records,errors}:{day:WorkDay;records:WorkRecord[];errors:string[]}) {
 const proposed=workDayRecords(records,day.day),check=sequenceProblems(proposed,day.schedule);
 const remaining=[...new Set([...errors,...check.errors,...check.warnings])];
 const punches=(list:WorkRecord[])=>list.length?<ul className="space-y-1">{list.map(r=><li key={r.id}>{r.type} · {originalPunchDateTime(r.at)}{r.status!=="VALID"?` · ${r.status}`:""}{r.excluded?" · Excluded from DTR":""}</li>)}</ul>:<p>No punches</p>;
 return <div className="border-t border-slate-200 pt-1">
  {!!remaining.length&&<p className="break-words text-xs text-amber-900">{remaining.length} remaining issue{remaining.length===1?"":"s"} / warning{remaining.length===1?"":"s"}: {remaining.join(" · ")}</p>}
  <details><summary className={summary}>Day context · {day.day} · {day.issues.length} current issues · {remaining.length} preview warnings</summary>
   <div className="space-y-2 pb-3 text-sm">
    <p>Schedule: {day.schedule?.checkInTime&&day.schedule.checkOutTime?`${day.schedule.checkInTime} – ${day.schedule.checkOutTime}`:"Missing"}{day.rest?" · Rest day":""}{day.leave?` · ${day.leave} leave minutes`:""}</p>
    {!!day.issues.length&&<p className="text-amber-900">Current issues: {day.issues.join(" · ")}</p>}
    <div className="grid gap-3 md:grid-cols-2"><div><h6 className="font-semibold">Current sequence</h6>{punches(day.records)}</div><div><h6 className="font-semibold">Proposed sequence · preview</h6>{punches(proposed)}</div></div>
    <p className="text-xs text-slate-600">Philippine time. Adjacent dates remain visible for overnight shifts. This preview does not calculate payroll; final batch review checks affected periods.</p>
   </div>
  </details>
 </div>;
}

function ChangeRow({change:c,draft,employee,board,editChange,remove}:{change:WorkChange;draft:WorkDraft;employee?:WorkEmployee;board:WorkBoard;editChange:Props["editChange"];remove:()=>void}) {
 const issues=verificationIssues(employee,draft,c,board.employees),effectiveEmployee=employee?{...employee,contextRecords:draftRecords(employee,draft),days:employee.days.map(d=>({...d,records:draftRecords(employee,draft).filter(r=>d.records.some(x=>x.id===r.id))}))}:employee,record=changeRecord(effectiveEmployee,c);
 const edit=(patch:Partial<WorkChange>)=>editChange(draft.employeeId,c.id,patch);
 const existingManual=c.kind==="Manual"&&employee?draftRecords(employee,draft).filter(r=>r.source==="Manual"&&r.rawLogId!==undefined&&r.status==="VALID"&&!r.excluded&&r.type===c.type&&workDate(r.at)===c.day):[];
 return <section aria-label={`${changeLabels[c.kind]} ${c.day}`} data-review-incomplete={issues.length>0} tabIndex={-1} className="min-w-0 scroll-mt-20 space-y-2 border-t border-slate-200 py-3 outline-none">
  <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
   <div className="min-w-0 space-y-2 break-words"><h5 className="text-sm font-semibold">{c.day} · {changeLabels[c.kind]}</h5><ChangeSummary change={c} employee={effectiveEmployee} board={board}/>
    {existingManual.map(r=><div key={r.id} className="rounded-lg bg-amber-50 p-2 text-sm"><p>A manual {r.type} already exists at {originalPunchDateTime(r.at)}.</p><button type="button" className={button} onClick={()=>edit({kind:"Time",rawLogId:r.rawLogId,eventId:undefined,type:undefined})}>Correct existing manual {r.type} instead</button></div>)}
    {(c.kind==="Direction"||c.kind==="Manual")&&<label className="block text-xs font-medium">Direction<select aria-label="Direction" className={field} value={c.type??""} onChange={e=>edit({type:e.target.value as "IN"|"OUT"})}><option value="">Select</option><option>IN</option><option>OUT</option></select></label>}
    {(c.kind==="Time"||c.kind==="Manual")&&<label className="block text-xs font-medium">Actual Philippine date and time<input aria-label="Actual Philippine date and time" type="datetime-local" step="0.001" className={field} value={c.at??""} onChange={e=>edit({at:e.target.value})}/><span className="block text-xs font-normal text-slate-600">Enter the actual time. Missing uploads are a warning; the payroll administrator decides.</span></label>}
    {c.kind==="Employee"&&<label className="block text-xs font-medium">Correct employee<select aria-label="Correct employee" className={field} value={c.targetEmployeeId??""} onChange={e=>edit({targetEmployeeId:e.target.value})}><option value="">Select verified identity</option>{board.employees.filter(p=>p.sourceIds.length===1&&p.id!==draft.employeeId).map(p=><option key={p.id} value={p.id}>{p.no} · {p.name}</option>)}</select><span className="text-xs font-normal">The receiving employee is added to the batch. Verify both sequences.</span></label>}
   </div>
   {!!issues.length&&<ul className="list-inside list-disc break-words text-xs text-amber-900">{issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
  </div>
  <div className="flex items-start gap-2"><details className="min-w-0 flex-1"><summary className={summary}>Capture details, optional note and saved history</summary><div className="space-y-2 pb-2 text-xs"><label className="block text-xs font-medium">Change note (optional)<input aria-label="Change note (optional)" className={field} value={c.reason} onChange={e=>edit({reason:e.target.value})} placeholder="Override the employee note if useful"/></label>
   {c.evidence&&<p className="whitespace-pre-wrap break-words">Previously recorded evidence: {c.evidence}</p>}
   {record&&<><p>{record.source} · {record.status}{record.excluded?" · Excluded from DTR":""}</p><p className="break-all">Capture reference: {record.id}</p>{(record.originalAt&&record.originalAt!==record.at||record.originalType&&record.originalType!==record.type)&&<p>Original capture: {record.originalType??record.type} · {originalPunchDateTime(record.originalAt??record.at)}</p>}{record.clockFlag&&<p className="text-amber-900">Device clock warning · {record.clockVerified?"Effective time verified":"Actual time needs verification"}</p>}</>}
  </div></details><button type="button" className={button} onClick={remove} aria-label={`Remove ${changeLabels[c.kind]} ${c.day}`}>Remove</button></div>
 </section>;
}

export function BatchReview({board,drafts,busy,onChange,editDraft,editChange,onNotice,onAdd,onScheduleSaved}:Props) {
 const [reason,setReason]=useState(""),[status,setStatus]=useState("");
 const missingReasons=drafts.filter(d=>!d.reason.trim()).length;
 const selected=drafts.flatMap(d=>d.changes);
 const context=Array.from(new Map(drafts.flatMap(d=>{const p=board.employees.find(p=>p.id===d.employeeId);return p?draftRecords(p,d):[];}).map(r=>[r.id,r])).values());
 const missing=drafts.reduce((n,d)=>n+d.changes.filter(c=>verificationIssues(board.employees.find(p=>p.id===d.employeeId),d,c,board.employees).length>0).length,0);
 const warnings=drafts.reduce((n,d)=>n+(board.employees.find(p=>p.id===d.employeeId)?.days.filter(day=>d.days.includes(day.day)).reduce((n,day)=>n+day.issues.length,0)??0),0);
 function applyNote(){onChange(applyBatchNote(drafts,reason));const message=`Optional note added to ${missingReasons} employee plans. Existing notes retained.`;setStatus(message);onNotice(message);}
 return <fieldset disabled={busy} className="min-w-0 space-y-3" aria-label="Selected batch changes">
  <div className="space-y-3 rounded-xl border bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-bold">Selected changes · {drafts.length} employees / {selected.length} changes</h3><p className="text-sm font-semibold">{selected.length-missing} ready · {missing} missing required input · {warnings} warnings</p></div>
   {status&&<p role="status" className="rounded-lg bg-blue-50 p-2 text-sm text-blue-900">{status}</p>}
   {selected.length>0?<><p className="text-sm text-slate-600">Enter the correction values, review the exact changes, then confirm. Notes are optional; no evidence entry or per-change verification is required.</p>
   <details><summary className={summary}>Add a shared note (optional)</summary><label className="min-w-0 text-sm">Note for this batch<input className={field} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Add context if useful"/></label><div className="mt-2 flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={!reason.trim()||!missingReasons} onClick={applyNote}>Apply note to blank fields</button><p className="text-xs text-slate-600">Applies to all {missingReasons} employee plans without a note, including collapsed cards. Existing notes and saved history are retained.</p></div></details>
   </>:<p className="text-sm text-slate-600">Select suggestions or add changes from a day review to build a batch.</p>}
  </div>
  {drafts.map(d=>{
   const employee=board.employees.find(p=>p.id===d.employeeId),stale=!employee||d.version!==draftVersion(employee,d.days),count=d.changes.filter(c=>!verificationIssues(employee,d,c,board.employees).length).length;
   const related=drafts.flatMap(plan=>plan.changes.map(c=>({...c,employeeId:plan.employeeId}))).filter(c=>c.employeeId===d.employeeId||c.targetEmployeeId===d.employeeId);
   const simulation=simulateWork(context,related,d.employeeId);
   return <article key={d.employeeId} aria-label={`${employee?.name??"Unavailable employee"} plan`} className="min-w-0 rounded-xl border bg-white px-3 pt-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h4 className="break-words font-semibold">{employee?.name??"Unavailable employee"} <span className="text-xs font-normal text-slate-600">{employee?.no}</span></h4><p className="break-words text-xs text-slate-600">{d.days.join(" · ")}</p></div><p className="text-xs font-semibold">{count}/{d.changes.length} ready</p></div>
    {(d.needed||d.rejected||stale)&&<p className="mt-1 break-words text-xs text-amber-900">{[d.rejected?"Rejected proposal — current approved attendance retained":"",stale?"Evidence changed — use Progress & history to resume a fresh review":"",d.needed?`Previous request: ${d.needed}`:""].filter(Boolean).join(" · ")}</p>}
    <div className="mt-2 grid items-start gap-x-3 md:grid-cols-2"><label className="block text-xs font-medium">Employee note (optional)<input className={field} value={d.reason} onChange={e=>editDraft(d.employeeId,{reason:e.target.value})} placeholder="Add context if useful"/></label>
     <details><summary className={summary}>Plan details · {board.owners.find(o=>o.id===d.ownerId)?.name??"Me"}</summary><div className="space-y-2 pb-2 text-xs"><label className="block">Owner<select aria-label="Owner" className={field} value={d.ownerId} onChange={e=>editDraft(d.employeeId,{ownerId:e.target.value})}><option value="">Me</option>{board.owners.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></label><label className="flex min-h-11 items-center gap-2"><input className="h-5 w-5 shrink-0" type="checkbox" checked={d.rejected} onChange={e=>editDraft(d.employeeId,{rejected:e.target.checked})}/>Reject this suggestion. Current approved attendance remains in effect.</label></div></details>
    </div>
    {[...new Set(d.changes.map(c=>c.day))].sort().map(day=><div key={day}>{d.changes.filter(c=>c.day===day).map(c=><ChangeRow key={c.id} change={c} draft={d} employee={employee} board={board} editChange={editChange} remove={()=>onChange(drafts.map(p=>{if(p.employeeId!==d.employeeId)return p;const changes=p.changes.filter(x=>x.id!==c.id),days=[...new Set(changes.map(x=>x.day))].sort();return {...p,changes,days,version:p.version.split("|").filter(v=>days.some(day=>v.startsWith(`${day}:`))).join("|")};}).filter(p=>p.changes.length))}/>)}{employee?.days.find(x=>x.day===day)&&<><DayContext day={employee.days.find(x=>x.day===day)!} records={simulation.records} errors={simulateWork(context,related.filter(c=>c.day===day),d.employeeId).errors}/>{onAdd&&<details className="border-t py-2"><summary className={summary}>Add correction · {day}</summary><div className="flex flex-wrap gap-2">{(["Manual","ConfirmSequence","NoAttendance"] as WorkKind[]).map(kind=><button type="button" key={kind} className={button} onClick={()=>onAdd(d.employeeId,day,kind)}>{changeLabels[kind]}</button>)}</div>{workDayRecords(draftRecords(employee,d),day).map(record=><div key={record.id} className="py-2 text-sm"><p>{record.type} · {originalPunchDateTime(record.at)}</p><div className="flex flex-wrap gap-2">{(record.source==="API"?["Direction","Time","Employee",record.status==="VALID"?"Void":"Restore",record.excluded?"Retain":"Exclude"]:[...(record.source==="Manual"&&record.rawLogId!==undefined?["Time","Direction"]:[]),record.excluded?"Retain":"Exclude"]).map(kind=><button type="button" key={kind} className={button} onClick={()=>onAdd(d.employeeId,day,kind as WorkKind,record)}>{changeLabels[kind as WorkKind]}</button>)}</div></div>)}{onScheduleSaved&&<DaySchedule employeeId={d.employeeId} day={day} onSaved={onScheduleSaved}/>}</details>}</>}</div>)}
   </article>;
  })}
 </fieldset>;
}
