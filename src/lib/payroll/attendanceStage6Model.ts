import { draftVersion, retainedDraftVersion, workDate, type WorkDraft, type WorkEmployee, type WorkChange, type WorkPlanView } from "./attendanceWorkbenchModel";

export type DayTarget={employeeId:string;day:string};
export const dayTargetKey=(target:DayTarget)=>`${target.employeeId}:${target.day}`;
export function affectedWorkDates(draft:WorkDraft,records:import("./attendanceWorkbenchModel").WorkRecord[]) {
 return [...new Set([...draft.days,...draft.changes.flatMap(c=>[...(c.at?[c.at.slice(0,10)]:[]),...records.filter(r=>c.eventId?r.id===c.eventId:c.rawLogId!==undefined&&r.rawLogId===c.rawLogId).map(r=>workDate(r.at))])])].sort();
}
export function uniqueDayTargets(targets:DayTarget[]){return [...new Map(targets.map(t=>[dayTargetKey(t),t])).values()].sort((a,b)=>dayTargetKey(a).localeCompare(dayTargetKey(b)));}
function emptyDraft(employeeId:string):WorkDraft{return {employeeId,days:[],changes:[],reason:"",ownerId:"",needed:"",rejected:false,version:""};}
function assertBatchSize(drafts:WorkDraft[]){if(drafts.length>20||drafts.reduce((n,d)=>n+d.changes.length,0)>200)throw Error("A batch supports 20 employees and 200 changes. Reduce the selected dates; nothing was added.");}

/** Preserve every existing edit. Switching evidence only resets affected attestations. */
export function adoptIncomingDraft(employee:WorkEmployee,previous:WorkDraft|undefined,day:string,id:()=>string):WorkDraft {
 const context=employee.days.find(d=>d.day===day);
 if(!context?.decision)throw Error("Incoming attendance is unavailable. Refresh this employee.");
 const base=previous??emptyDraft(employee.id);
 const incomingDays=[...new Set([day,...context.decision.incomingRecords.map(r=>workDate(r.at))])].filter(date=>employee.days.some(d=>d.day===date));
 const days=[...new Set([...base.days,...incomingDays])].sort();
 return {...base,days,version:retainedDraftVersion(employee,days,base),incomingVersions:{...base.incomingVersions,[day]:context.decision.incomingDigest},changes:[...base.changes.map(c=>incomingDays.includes(c.day)?{...c,verified:false}:c),...incomingDays.filter(date=>!base.changes.some(c=>c.day===date&&c.kind==="ReopenDay")).map(date=>({id:id(),day:date,kind:"ReopenDay" as const,reason:"",evidence:"",verified:false}))]};
}

/** A no-work decision includes exact exclusions, including displayed overnight context. */
export function buildNoWorkDrafts(drafts:WorkDraft[],people:WorkEmployee[],targets:DayTarget[],note:string,id:()=>string) {
 const next=drafts.map(d=>({...d,changes:[...d.changes],days:[...d.days]}));
 const selected=uniqueDayTargets(targets);if(!selected.length)throw Error("Select workdays first.");
 for(const target of selected){
  const employee=people.find(e=>e.id===target.employeeId),day=employee?.days.find(d=>d.day===target.day);
  if(!employee||!day)throw Error("A selected date is no longer eligible. Refresh the employee before continuing.");
  let draft=next.find(d=>d.employeeId===employee.id);
  if(draft?.changes.some(c=>c.day===target.day&&c.kind!=="Exclude"))throw Error(`${employee.name} · ${target.day} already has draft edits. Review them before replacing this day with no work.`);
  if(!draft){draft=emptyDraft(employee.id);next.push(draft);}
  const old={...draft};draft.days=[...new Set([...draft.days,target.day])].sort();draft.version=retainedDraftVersion(employee,draft.days,old);
  if(!draft.reason.trim())draft.reason=note.trim();
  for(const record of day.records.filter(r=>r.status==="VALID"&&!r.excluded)){
   const targetRef=record.source==="API"?{eventId:record.id}:{rawLogId:record.rawLogId};
   if(record.source!=="API"&&record.rawLogId===undefined)throw Error("A selected capture has no stable reference; refresh before reviewing no work.");
   if(!draft.changes.some(c=>c.kind==="Exclude"&&(targetRef.eventId?c.eventId===targetRef.eventId:c.rawLogId===targetRef.rawLogId)))draft.changes.push({id:id(),day:target.day,kind:"Exclude",...targetRef,reason:note.trim(),evidence:"",verified:false});
  }
  draft.changes.push({id:id(),day:target.day,kind:"NoAttendance",reason:note.trim(),evidence:"",verified:false});
 }
 assertBatchSize(next);return next;
}

export function appendManualDraft(drafts:WorkDraft[],employee:WorkEmployee,change:WorkChange,note:string) {
 const existing=drafts.find(d=>d.employeeId===employee.id),base=existing??emptyDraft(employee.id);
 if(!employee.days.some(d=>d.day===change.day))throw Error("Workday is no longer available.");
 const days=[...new Set([...base.days,change.day])].sort();
 const next={...base,reason:base.reason.trim()?base.reason:note.trim(),days,version:existing?retainedDraftVersion(employee,days,existing):draftVersion(employee,days),changes:[...base.changes.filter(c=>c.id!==change.id),change]};
 const all=[...drafts.filter(d=>d.employeeId!==employee.id),next];assertBatchSize(all);return all;
}

export function sourceDeliveryLabel(plan:WorkPlanView) {
 if(!plan.approved)return "Decision not approved";
 if(plan.state==="Resolved")return plan.result?.startsWith("Local")?"Local payroll override approved":plan.result?.startsWith("Source delivery retired")?"Source delivery retired":"Historical source delivery confirmed";
 if(plan.state==="Needs fresh review"||plan.state==="Source conflict")return "Source evidence needs review — approved decision retained";
 if(plan.state==="Failed")return "Source update failed — approved decision retained";
 if(plan.state==="Superseded")return "Continued in a later decision";
 return "Approval recovery pending — approved decision retained";
}
export function deliverySummary(plans:WorkPlanView[]) {
 const active=plans.filter(p=>p.approved&&!p.supersededBy?.length&&!['Resolved','Superseded','Removed from draft'].includes(p.state));
 const conflicts=active.filter(p=>['Needs fresh review','Source conflict'].includes(p.state)).length;
 const failures=active.filter(p=>p.state==='Failed').length;
 return conflicts?`${conflicts} incoming attendance reviews · decisions retained`:failures?`${failures} historical deliveries need reconciliation`:active.length?`${active.length} historical deliveries to reconcile`:"Local decisions retained · phone attendance unchanged";
}
