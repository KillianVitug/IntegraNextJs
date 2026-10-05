import { manilaWallTime, sourceDayOffset, type SourcePunch } from "./attendanceSourceClient";
import type { ShiftWindow } from "./attendance";

export type WorkKind="Direction"|"Time"|"Employee"|"Void"|"Restore"|"Manual"|"ConfirmSequence"|"NoAttendance"|"Exclude"|"Retain"|"UndoCapture"|"ReopenDay";
export type WorkChange={id:string;day:string;kind:WorkKind;eventId?:string;rawLogId?:number;type?:"IN"|"OUT";at?:string;targetEmployeeId?:string;employeeId?:string;status?:"VALID"|"VOID";clockVerified?:boolean;reason:string;evidence:string;verified:boolean};
export type WorkDraft={employeeId:string;days:string[];changes:WorkChange[];reason:string;ownerId:string;needed:string;rejected:boolean;version:string;undoOf?:string;replaces?:string};
export type WorkRecord={id:string;source:"API"|"Manual"|"File";rawLogId?:number;employeeId:string;type:"IN"|"OUT"|"UNSPECIFIED";at:string;status:"VALID"|"VOID";clockFlag:boolean;clockVerified?:boolean;originalType?:string;originalAt?:string;sourceEmployeeId?:string;sourcePunch?:SourcePunch;excluded?:boolean};
export type WorkDay={day:string;schedule:ShiftWindow|null;rest:boolean;leave:number;leaveEvidence:unknown;configuration:unknown;records:WorkRecord[];status:string;issues:string[];suggestions:{label:string;explanation:string;changes:Partial<WorkChange>[]}[];version:string;resolved:boolean};
export type WorkEmployee={id:string;no:string;name:string;sourceIds:string[];mappingEvidence:unknown;hired:string|null;separated:string|null;days:WorkDay[];contextRecords?:WorkRecord[]};
export type WorkPlanView={id:string;batchId:string;revision:number;state:string;draft:WorkDraft;result:string|null;updatedAt:string};
export type WorkBoard={period:{id:string;code:string;startDate:string;endDate:string;posted:boolean};employees:WorkEmployee[];plans:WorkPlanView[];history?:{id:string;planId:string|null;action:string;actor:string;at:string}[];adjustments:{id:string;employeeId:string;periodId:string;state:string;impact:unknown;reference:string|null;conclusion:string|null}[];owners:{id:string;name:string}[];statuses:{sync:string;review:string;delivery:string;dtr:string;payroll:string};enabled:boolean};
export const localToInstant=(value:string)=> {
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(value))return null;
 const at=Date.parse(value+"+08:00");if(!Number.isFinite(at))return null;
 const iso=new Date(at).toISOString(),wall=manilaWallTime(iso).timestamp.replace(" ","T");
 return wall.startsWith(value)?iso:null;
};
export const workDate=(at:string)=>manilaWallTime(at).date;
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
  if(c.kind==="Manual") {const at=c.at&&localToInstant(c.at);if(!at||!c.type){errors.push("Enter a verified date and time; no assumed time is supplied");continue;}next.push({id:c.id,source:"Manual",employeeId:c.employeeId??employeeId,type:c.type,at,status:"VALID",clockFlag:false});continue;}
  if(["ConfirmSequence","NoAttendance","ReopenDay"].includes(c.kind))continue;
  const key=c.eventId??`raw:${c.rawLogId}`;
  if(used.has(`${key}:${c.kind}`)||c.kind==="Void"&&used.has(`${key}:Restore`)||c.kind==="Restore"&&used.has(`${key}:Void`)){errors.push("Conflicting actions select the same punch");continue;}used.add(`${key}:${c.kind}`);
  const r=next.find(r=>r.id===c.eventId||c.rawLogId!==undefined&&r.rawLogId===c.rawLogId);
  if(!r){errors.push("Selected punch is outside this employee and date context");continue;}
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
 for(const d of days.filter(d=>d.status==="Missing workday"&&!d.resolved).sort((a,b)=>a.day.localeCompare(b.day))){const last=ranges.at(-1);if(last&&sourceDayOffset(last.through,1)===d.day){last.through=d.day;last.days.push(d.day);}else ranges.push({from:d.day,through:d.day,days:[d.day]});}
 return ranges;
}
