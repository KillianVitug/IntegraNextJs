import { groupLogsByEmployeeAndAttendanceDate, type ShiftWindow } from "./attendance";
import { manilaWallTime, type SourcePunch } from "./attendanceSourceClient";

export type AttendanceInputPunch = { id:string; type:"IN"|"OUT"|"UNSPECIFIED"; at:string; included:boolean; reason:string|null; evidenceState?:"effective"|"pending"|"resolved"|"voided"|"excluded" };
export type AttendanceDayInput = { punches:AttendanceInputPunch[]; issues:string[]; missingDirection:"IN"|"OUT"|null; complete:boolean; canConfirmExisting:boolean; lateConflict?:boolean };
export type SourceDayEligibility = { day:string; eligible:boolean; reason:string|null; contextualFlagsResolved:boolean };
/** Draft/Stale runs retain their snapshots but do not freeze current attendance. */
export function freezesAttendanceInput(status:string,group:unknown){return group!=="Monthly"&&["Reviewed","Approved","Posted"].includes(status);}
const sequenceFlags=new Set(["CONSECUTIVE_IN","CONSECUTIVE_OUT","NO_EARLIER_IN","NO_FOLLOWING_OUT"]);
const sourceLabels:Record<string,string>={CONSECUTIVE_IN:"Repeated IN needs review",CONSECUTIVE_OUT:"Repeated OUT needs review",NO_EARLIER_IN:"Missing IN",NO_FOLLOWING_OUT:"Missing OUT",CLOSE_PUNCHES_ACROSS_PHONES:"Nearby captures from different devices need review"};

/** Sequence warnings from the phone span calendar days. Re-evaluate only those
 * warnings against the actual scheduled workday; never dismiss clock/identity or
 * close-device warnings. A lone previous-day IN is not borrowed by a day shift. */
export function sourceDayEligibility(records:SourcePunch[], employeeFor:(punch:SourcePunch)=>string|null, scheduleFor:(employeeId:string,day:string)=>ShiftWindow|null) {
 const result=new Map<string,SourceDayEligibility>();
 const logs=records.filter(p=>p.status==="VALID"&&employeeFor(p)).map(p=>{const wall=manilaWallTime(p.capturedAt);return {employeeId:employeeFor(p)!,employeeNo:p.employeeId,loggedAt:new Date(p.capturedAt),logDate:wall.date,logTime:wall.time,direction:p.type,sourceLine:0,rawText:"",punch:p};});
 const groups=groupLogsByEmployeeAndAttendanceDate(logs,(log,day)=>scheduleFor(log.employeeId!,day));
 const byId=new Map(records.map(p=>[p.eventId,p]));
 for(const [key,group] of groups){
  const [employeeId,day]=key.split("|"),schedule=scheduleFor(employeeId,day);
  const ordered=group.map(log=>(log as typeof logs[number]).punch).sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt)||a.eventId.localeCompare(b.eventId));
  const complete=ordered.length>0&&ordered.length%2===0&&(!schedule?.requiresSplitPunches||ordered.length>=4)&&ordered.every((p,i)=>p.type===(i%2?"OUT":"IN")&&(!i||Date.parse(p.capturedAt)>Date.parse(ordered[i-1].capturedAt))&&(!(i%2)||Date.parse(p.capturedAt)-Date.parse(ordered[i-1].capturedAt)<=86400000));
  for(const punch of ordered){
   const unresolved=punch.reviewResolved?[]:punch.reviewFlags.filter(flag=>!(complete&&sequenceFlags.has(flag)));
   const reason=punch.clockFlag&&!punch.clockVerified?"Device clock needs verification":unresolved.length?[...new Set(unresolved.map(flag=>sourceLabels[flag]??"Additional source warning requires investigation"))].join("; "):null;
   result.set(punch.eventId,{day,eligible:!reason,reason,contextualFlagsResolved:complete&&!punch.reviewResolved&&punch.reviewFlags.some(flag=>sequenceFlags.has(flag))});
   byId.delete(punch.eventId);
  }
 }
 for(const punch of byId.values())result.set(punch.eventId,{day:manilaWallTime(punch.capturedAt).date,eligible:false,reason:punch.status==="VOID"?"Voided source capture":"Employee identity needs matching",contextualFlagsResolved:false});
 return result;
}

function sequence(punches:AttendanceInputPunch[]) {
 const ordered=[...punches].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id));
 if(ordered.length&&ordered.every(punch=>punch.type==="UNSPECIFIED")){
  const complete=ordered.length%2===0&&ordered.every((punch,index)=>!index||Date.parse(punch.at)>Date.parse(ordered[index-1].at))&&ordered.every((punch,index)=>index%2===0||Date.parse(punch.at)-Date.parse(ordered[index-1].at)<=86400000);
  return {complete,missingDirection:null,ambiguous:!complete,invalidDuration:ordered.some((punch,index)=>index%2===1&&Date.parse(punch.at)-Date.parse(ordered[index-1].at)>86400000)};
 }
 let opened=false,openedAt=0,missingIn=false,missingOut=false,ambiguous=false,invalidDuration=false;
 for(const [index,punch] of ordered.entries()){
  if(index&&Date.parse(punch.at)===Date.parse(ordered[index-1].at))ambiguous=true;
  if(punch.type==="IN"){if(opened){missingOut=true;ambiguous=true;}opened=true;openedAt=Date.parse(punch.at);}
  else if(punch.type==="OUT"){if(!opened)missingIn=true;else if(Date.parse(punch.at)-openedAt>86400000)invalidDuration=true;opened=false;}
  else ambiguous=true;
 }
 if(opened)missingOut=true;
 return {complete:ordered.length>0&&!missingIn&&!missingOut&&!ambiguous&&!invalidDuration,missingDirection:missingIn&&!missingOut?"IN" as const:missingOut&&!missingIn?"OUT" as const:null,ambiguous,invalidDuration};
}
export function buildAttendanceDayInput(punches:AttendanceInputPunch[]):AttendanceDayInput {
 // Audit captures remain visible, but an explicitly resolved/voided/excluded
 // capture is not another IN/OUT in the current sequence. The string fallback
 // keeps older callers compatible; live readers supply the explicit state.
 const active=punches.filter(p=>p.included||(!["resolved","voided","excluded"].includes(p.evidenceState??"")&&!p.reason?.startsWith("Voided")&&!p.reason?.startsWith("Excluded")));
 const known=sequence(active),payable=sequence(punches.filter(p=>p.included));
 const held=[...new Set(active.filter(p=>!p.included&&p.reason).map(p=>p.reason!))];
 const issues=[...held];
 if(known.invalidDuration)issues.push("Shift exceeds 24 hours; verify dates or split the shift");
 if(known.missingDirection)issues.push(`Missing ${known.missingDirection}`);
 else if(known.ambiguous||active.length&&!known.complete)issues.push("Review repeated or incomplete IN/OUT sequence");
 return {punches,issues,missingDirection:known.missingDirection,complete:payable.complete,canConfirmExisting:known.complete&&held.length>0&&!held.some(reason=>/clock|identity|investigation|retained|overlapping/i.test(reason))};
}
