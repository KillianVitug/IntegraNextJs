import { manilaWallTime, sourceDayOffset, type SourcePunch } from "./attendanceSourceClient";
import type { ShiftWindow } from "./attendance";

export type WorkKind="Direction"|"Time"|"Employee"|"Void"|"Restore"|"Manual"|"ConfirmSequence"|"NoAttendance"|"Exclude"|"Retain"|"UndoCapture"|"ReopenDay";
export type WorkChange={id:string;day:string;kind:WorkKind;eventId?:string;rawLogId?:number;type?:"IN"|"OUT";at?:string;targetEmployeeId?:string;employeeId?:string;status?:"VALID"|"VOID";clockVerified?:boolean;reason:string;evidence:string;verified:boolean};
export type WorkDraft={employeeId:string;days:string[];changes:WorkChange[];reason:string;ownerId:string;needed:string;rejected:boolean;version:string;undoOf?:string;replaces?:string;incomingVersions?:Record<string,string>};
export type WorkRecord={id:string;source:"API"|"Manual"|"File";rawLogId?:number;employeeId:string;type:"IN"|"OUT"|"UNSPECIFIED";at:string;status:"VALID"|"VOID";clockFlag:boolean;clockVerified?:boolean;originalType?:string;originalAt?:string;sourceEmployeeId?:string;sourcePunch?:SourcePunch;excluded?:boolean};
export type WorkFinding={code:string;severity:"error"|"warning";employeeId:string;day:string;message:string};
export type WorkDay={findings?:WorkFinding[];day:string;schedule:ShiftWindow|null;rest:boolean;leave:number;leaveEvidence:unknown;configuration:unknown;records:WorkRecord[];status:string;issues:string[];suggestions:{label:string;explanation:string;changes:Partial<WorkChange>[]}[];version:string;resolved:boolean;decision?:{planId?:string;payrollRunId?:string;revision?:string;approvedAt:string;reason:string;lateConflict:boolean;incomingDigest:string;incomingRecords:WorkRecord[]}};
export type WorkEmployee={id:string;no:string;name:string;sourceIds:string[];mappingEvidence:unknown;hired:string|null;separated:string|null;days:WorkDay[];contextRecords?:WorkRecord[]};
export type WorkPlanView={id:string;batchId:string;revision:number;state:string;draft:WorkDraft;result:string|null;approved?:boolean;approvedAt?:string;supersededBy?:string[];updatedAt:string};
export type WorkProgress=Pick<WorkBoard,"plans"|"history"|"adjustments"|"owners">;
const editablePlanStates=["Draft","Ready for approval","Needs evidence","Rejected","Needs fresh review"];
/** Conservative display classification: every exact requested correction must have
 * a later approval. Partial overlaps, changed values and new intentions stay visible. */
export function classifyWorkPlans(plans:WorkPlanView[]):WorkPlanView[] {
 const key=(c:WorkChange)=>JSON.stringify([c.day,c.kind,c.eventId??null,c.rawLogId??null,c.type??null,c.at?(localToInstant(c.at)??c.at):null,c.targetEmployeeId??null,c.employeeId??null,c.status??null,c.clockVerified??null]);
 return plans.map(plan=>{
  if(plan.approved||!editablePlanStates.includes(plan.state)||!plan.draft.changes.length||plan.draft.undoOf||plan.draft.replaces||Object.keys(plan.draft.incomingVersions??{}).length)return plan;
  const later=plans.filter(p=>p.id!==plan.id&&p.approved&&p.approvedAt&&p.approvedAt>plan.updatedAt&&p.draft.employeeId===plan.draft.employeeId&&!p.draft.undoOf&&!p.draft.replaces&&!Object.keys(p.draft.incomingVersions??{}).length);
  const covering=plan.draft.changes.map(c=>later.find(p=>p.draft.changes.some(other=>key(other)===key(c))&&!plans.some(newer=>newer.approved&&newer.approvedAt&&newer.approvedAt>p.approvedAt!&&newer.draft.employeeId===plan.draft.employeeId&&newer.draft.days.includes(c.day))));
  return covering.every(Boolean)?{...plan,supersededBy:[...new Set(covering.map(p=>p!.id))]}:plan;
 });
}
export function isActiveWorkPlan(plan:WorkPlanView) {
 return !plan.supersededBy?.length&&!['Resolved','Removed from draft','Superseded'].includes(plan.state);
}
export type WorkBoard={period:{id:string;code:string;startDate:string;endDate:string;posted:boolean};employees:WorkEmployee[];plans:WorkPlanView[];history?:{id:string;planId:string|null;action:string;actor:string;at:string}[];adjustments:{id:string;employeeId:string;periodId:string;state:string;impact:unknown;reference:string|null;conclusion:string|null}[];owners:{id:string;name:string}[];statuses:{sync:string;review:string;delivery:string;dtr:string;payroll:string};enabled:boolean};
export const localToInstant=(value:string)=> {
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(value))return null;
 const at=Date.parse(value+"+08:00");if(!Number.isFinite(at))return null;
 const iso=new Date(at).toISOString(),wall=manilaWallTime(iso).timestamp.replace(" ","T");
 return wall.startsWith(value)?iso:null;
};
export const workDate=(at:string)=>manilaWallTime(at).date;
export function draftVersion(employee:WorkEmployee,days:string[]) {
 return [...new Set(days)].sort().map(day=>`${day}:${employee.days.find(d=>d.day===day)?.version??"missing"}`).join("|");
}
/** Incoming evidence is adopted only through an explicit, versioned draft. */
export function draftRecords(employee:WorkEmployee,draft:WorkDraft) {
 let records=employee.contextRecords??employee.days.flatMap(d=>d.records);
 for(const day of Object.keys(draft.incomingVersions??{})){
  const context=employee.days.find(d=>d.day===day),incoming=context?.decision?.incomingRecords??[];
  const ids=new Set([...(context?.records??[]),...incoming].map(r=>r.id));
  records=[...records.filter(r=>!ids.has(r.id)&&workDate(r.at)!==day),...incoming];
 }
 return [...new Map(records.filter(r=>draft.days.some(day=>workDayRecords(records,day).some(x=>x.id===r.id))||draft.changes.some(c=>c.eventId===r.id)).map(r=>[r.id,r])).values()];
}
/** Adding/removing dates must never silently accept changed evidence on retained dates. */
export function retainedDraftVersion(employee:WorkEmployee,days:string[],previous?:WorkDraft) {
 return [...new Set(days)].sort().map(day=>previous?.version.split("|").find(v=>v.startsWith(`${day}:`))??draftVersion(employee,[day])).join("|");
}
export function workDayRecords(records:WorkRecord[],day:string) {
 const all=records.slice().sort((a,b)=>a.at.localeCompare(b.at)),own=all.filter(r=>workDate(r.at)===day);
 const first=own.find(r=>r.status==="VALID"&&!r.excluded),last=own.filter(r=>r.status==="VALID"&&!r.excluded).at(-1);
 if(first?.type==="OUT"){const prev=all.filter(r=>r.at<first.at&&r.status==="VALID"&&!r.excluded).at(-1);if(prev?.type==="IN"&&Date.parse(first.at)-Date.parse(prev.at)<=86400000)own.unshift(prev);}
 if(last?.type==="IN"){const next=all.find(r=>r.at>last.at&&r.status==="VALID"&&!r.excluded);if(next?.type==="OUT"&&Date.parse(next.at)-Date.parse(last.at)<=86400000)own.push(next);}
 return own;
}
export function changeRecord(employee:WorkEmployee|undefined,change:WorkChange) {
 return [...(employee?.contextRecords??[]),...(employee?.days.flatMap(d=>d.records)??[])].find(r=>change.eventId?r.id===change.eventId:change.rawLogId!==undefined&&r.rawLogId===change.rawLogId);
}
/** Manual attendance is corrected locally with a new audited decision, never sent to a phone. */
export function canCorrectRecord(record:WorkRecord,kind:WorkKind) {
 return record.source==="API"||!["Direction","Time","Employee","Void","Restore","UndoCapture"].includes(kind)||(record.source==="Manual"&&record.rawLogId!==undefined&&["Direction","Time"].includes(kind));
}
export function dayNeedsReview(day:WorkDay) {
 return !day.resolved&&day.issues.length>0;
}
/** Input checks shared by draft verification and authoritative server preview. */
export function changeInputErrors(draft:WorkDraft,c:WorkChange,now=Date.now()) {
 const errors:string[]=[];
 if(c.evidence.trim().length<3)errors.push("Add verification evidence (at least 3 characters)");
 if((c.reason.trim()||draft.reason.trim()).length<3)errors.push("Add a reason (at least 3 characters)");
 if((c.kind==="Direction"||c.kind==="Manual")&&c.type!=="IN"&&c.type!=="OUT")errors.push("Select the verified direction");
 if((c.kind==="Time"||c.kind==="Manual")&&!c.at)errors.push("Actual time required");
 if(c.kind==="Employee"&&!c.targetEmployeeId)errors.push("Select a verified employee identity");
 const instant=c.at?localToInstant(c.at):null;
 if(c.at&&!instant)errors.push("Invalid verified capture time");
 if(instant&&Date.parse(instant)>now+300000)errors.push("Verified work cannot be in the future");
 if(c.kind==="Manual"&&c.at&&draft.days.length&&(c.at.slice(0,10)<sourceDayOffset(draft.days.slice().sort()[0],-1)||c.at.slice(0,10)>sourceDayOffset(draft.days.slice().sort().at(-1)!,1)))errors.push("Manual attendance is outside the reviewed shift context");
 return errors;
}
export function verificationIssues(employee:WorkEmployee|undefined,draft:WorkDraft,c:WorkChange,employees:WorkEmployee[],now=Date.now()) {
 const errors=changeInputErrors(draft,c,now);
 if(draft.rejected)errors.push("Plan is rejected");
 if(!employee||draft.version!==draftVersion(employee,draft.days))errors.push("Evidence changed — refresh and review this plan again");
 if(employee&&Object.entries(draft.incomingVersions??{}).some(([day,version])=>employee.days.find(d=>d.day===day)?.decision?.incomingDigest!==version))errors.push("Incoming evidence changed — review incoming attendance again");
 if(!draft.days.includes(c.day)||!employee?.days.some(d=>d.day===c.day))errors.push("Workday is outside employee eligibility");
 if(c.kind==="Manual"&&employee&&draftRecords(employee,draft).some(r=>r.id===c.id))errors.push("This manual punch is already recorded. Correct its time instead of adding it again.");
 if(!["Manual","ConfirmSequence","NoAttendance","ReopenDay"].includes(c.kind)){
  const record=(employee?draftRecords(employee,draft):[]).find(r=>c.eventId?r.id===c.eventId:r.rawLogId===c.rawLogId)??changeRecord(employee,c);
  if(!record||record.employeeId!==draft.employeeId)errors.push("Selected punch is unavailable — refresh and review");
  else if(!canCorrectRecord(record,c.kind))errors.push("This entry requires an explicit source selection and verified replacement");
 }
 if(c.kind==="Employee"&&c.targetEmployeeId){const target=employees.find(p=>p.id===c.targetEmployeeId);if(!target||target.id===draft.employeeId||target.sourceIds.length!==1||!target.days.some(d=>d.day===c.day))errors.push("Select an eligible employee with a verified unique identity");}
 return errors;
}
/** Keep attestations only while their exact values, effective reason and source remain current. */
export function reconcileDraftVerification(previous:WorkDraft[],next:WorkDraft[],employees:WorkEmployee[]) {
 return next.map(d=>{const old=previous.find(p=>p.employeeId===d.employeeId);return {...d,changes:d.changes.map(c=>{
  const before=old?.changes.find(p=>p.id===c.id);
  const content=(change:WorkChange)=>JSON.stringify({...change,verified:false,reason:""});
  const changed=before&&(content(before)!==content(c)||(before.reason.trim()||old!.reason.trim())!==(c.reason.trim()||d.reason.trim()));
  return {...c,verified:c.verified&&!changed&&!verificationIssues(employees.find(p=>p.id===d.employeeId),d,c,employees).length};
 })};});
}
export function applyBatchEvidence(drafts:WorkDraft[],evidence:string) {
 return drafts.map(d=>({...d,changes:d.changes.map(c=>c.evidence.trim()?c:{...c,evidence:evidence.trim(),verified:false})}));
}
export function applyBatchDetails(drafts:WorkDraft[],reason:string,evidence:string) {
 const next=evidence.trim()?applyBatchEvidence(drafts,evidence):drafts;
 return next.map(d=>({...d,reason:d.reason.trim()?d.reason:reason.trim()}));
}
export function verifyCompleteChanges(drafts:WorkDraft[],employees:WorkEmployee[]) {
 return drafts.map(d=>({...d,changes:d.changes.map(c=>({...c,verified:!verificationIssues(employees.find(p=>p.id===d.employeeId),d,c,employees).length}))}));
}
export function sequenceProblems(records:WorkRecord[],schedule:ShiftWindow|null) {
 const list=records.filter(r=>r.status==="VALID"&&!r.excluded).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
 const errors:string[]=[],warnings:string[]=[],pairs:{in:string;out:string;minutes:number}[]=[];
 let opened:WorkRecord|null=null;
 for(const [i,r] of list.entries()) {
  if(r.clockFlag&&!r.clockVerified)errors.push("Verify the device clock and actual capture time");
  if(i&&r.at===list[i-1].at)errors.push("Two effective punches have the same timestamp");
  if(r.type==="UNSPECIFIED"){errors.push("A file punch needs a verified IN/OUT direction");continue;}
  if(r.type==="IN"){if(opened)errors.push("Repeated IN or missing OUT");opened=r;}
  else if(!opened)errors.push("Missing IN or repeated OUT");
  else {const minutes=(Date.parse(r.at)-Date.parse(opened.at))/60000;if(minutes<=0)errors.push("Invalid interval");if(minutes>24*60)errors.push("Shift exceeds 24 hours; verify dates or split the shift");else if(minutes>16*60)warnings.push("Shift exceeds 16 hours; verify actual work and schedule");pairs.push({in:opened.at,out:r.at,minutes});opened=null;}
 }
 if(opened)errors.push("Missing OUT");
 if(pairs.length>1)warnings.push("Multiple intervals: confirm lunch, split shift or legitimate re-entry");
 if(pairs.some(p=>workDate(p.in)!==workDate(p.out)))warnings.push("Overnight shift: review both dates and payroll periods");
 const span=pairs.reduce((n,p)=>n+p.minutes,0);
 if(schedule?.hoursPerDay&&span>schedule.hoursPerDay*60+(schedule.breakMinutes??0)+120)warnings.push("Duration differs from the scheduled day by over two hours");
 return {errors:[...new Set(errors)],warnings:[...new Set(warnings)],pairs};
}
export function simulateWork(records:WorkRecord[],changes:WorkChange[],employeeId:string) {
 let next=records.map(r=>({...r}));
 const errors:string[]=[];
 const used=new Set<string>();
 for(const c of changes) {
  if(c.kind==="Manual") {if(next.some(r=>r.id===c.id)){errors.push("This manual punch is already recorded. Correct its time instead of adding it again.");continue;}const at=c.at&&localToInstant(c.at);if(!at||!c.type){errors.push("Enter a verified date and time; no assumed time is supplied");continue;}next.push({id:c.id,source:"Manual",employeeId:c.employeeId??employeeId,type:c.type,at,status:"VALID",clockFlag:false});continue;}
  if(["ConfirmSequence","NoAttendance","ReopenDay"].includes(c.kind))continue;
  const key=c.eventId??`raw:${c.rawLogId}`;
  if(used.has(`${key}:${c.kind}`)||c.kind==="Void"&&used.has(`${key}:Restore`)||c.kind==="Restore"&&used.has(`${key}:Void`)){errors.push("Conflicting actions select the same punch");continue;}used.add(`${key}:${c.kind}`);
  const r=next.find(r=>r.id===c.eventId||c.rawLogId!==undefined&&r.rawLogId===c.rawLogId);
  if(!r){errors.push("Selected punch is outside this employee and date context");continue;}
  if(r.source==="Manual"&&["Time","Direction"].includes(c.kind)){r.originalAt??=r.at;r.originalType??=r.type;}
  if(c.kind==="Direction")r.type=c.type??(r.type==="IN"?"OUT":"IN");
  if(c.kind==="Time"){const at=c.at&&localToInstant(c.at);if(!at)errors.push("Enter the verified capture date and time");else{r.at=at;r.clockVerified=true;}}
  if(c.kind==="Employee"){if(!c.targetEmployeeId)errors.push("Select a verified employee identity");else r.employeeId=c.targetEmployeeId;}
  if(c.kind==="Void"||c.kind==="Restore")r.status=c.kind==="Void"?"VOID":"VALID";
  if(c.kind==="Exclude"||c.kind==="Retain")r.excluded=c.kind==="Exclude";
  if(c.kind==="UndoCapture"){if(c.type)r.type=c.type;if(c.at){const at=localToInstant(c.at);if(at)r.at=at;else errors.push("Invalid original time");}if(c.targetEmployeeId)r.employeeId=c.targetEmployeeId;if(c.status)r.status=c.status;r.clockVerified=c.clockVerified;}
 }
 next=next.filter(r=>r.employeeId===employeeId);
 return {records:next.sort((a,b)=>a.at.localeCompare(b.at)),errors};
}
export function suggestionsForDay(day:string,records:WorkRecord[],schedule:ShiftWindow|null):WorkDay["suggestions"] {
 const original=sequenceProblems(records,schedule),out:WorkDay["suggestions"]=[];
 if(!original.errors.length)return out;
 for(const r of records.filter(r=>r.source==="API"&&r.status==="VALID"&&workDate(r.at)===day)) {
  const type=r.type==="IN"?"OUT":"IN",changed=records.map(p=>p.id===r.id?{...p,type} as WorkRecord:p);
  if(sequenceProblems(changed,schedule).errors.length<original.errors.length)out.push({label:`Review ${r.type} → ${type}`,explanation:"This single direction change reduces sequence errors. Confirm it using actual evidence; time of day is not proof.",changes:[{kind:"Direction",eventId:r.id,type,day}]});
 }
 const sorted=records.filter(r=>r.status==="VALID"&&!r.excluded).sort((a,b)=>a.at.localeCompare(b.at));
 sorted.forEach((r,i)=>{const before=sorted[i-1];if(before&&r.source==="API"&&before.type===r.type&&Date.parse(r.at)-Date.parse(before.at)<=300000)out.push({label:"Review close duplicate",explanation:"Keep the earlier capture only if both represent the same action.",changes:[{kind:"Void",eventId:r.id,day}]});});
 out.push({label:"Add verified missing time",explanation:"Check uploads first. Leave the time blank until the supervisor confirms it.",changes:[{kind:"Manual",day,type:sorted[0]?.type==="OUT"?"IN":"OUT"}]});
 return out;
}
export function dayStatus(args:{day:string;schedule:ShiftWindow|null;rest:boolean;leave:number;records:WorkRecord[];now:string}) {
 if(args.day>workDate(args.now))return "Future";
 if(args.rest)return args.records.some(r=>r.status==="VALID")?"Rest day attendance":"Rest day";
 if(!args.schedule?.checkInTime||!args.schedule.checkOutTime)return "Schedule missing";
 const outDay=args.schedule.checkOutTime<=args.schedule.checkInTime?sourceDayOffset(args.day,1):args.day;
 const finish=Date.parse(`${outDay}T${args.schedule.checkOutTime}+08:00`);
 if(Date.parse(args.now)<finish+30*60000)return "In progress / awaiting upload";
 if(args.leave>=(args.schedule.hoursPerDay??8)*60&&!args.records.some(r=>r.status==="VALID"))return "Approved leave";
 return args.records.some(r=>r.status==="VALID"&&!r.excluded)?"Review records":"Missing workday";
}

export function missingDateRanges(days:WorkDay[]) {
 const ranges:{from:string;through:string;days:string[]}[]=[];
 for(const d of days.filter(d=>(d.status==="Missing workday"||d.status==="No work recorded")&&!d.resolved).sort((a,b)=>a.day.localeCompare(b.day))){const last=ranges.at(-1);if(last&&sourceDayOffset(last.through,1)===d.day){last.through=d.day;last.days.push(d.day);}else ranges.push({from:d.day,through:d.day,days:[d.day]});}
 return ranges;
}
