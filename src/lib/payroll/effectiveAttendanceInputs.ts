import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import { attendanceDtrCorrections, attendanceImportBatches, attendanceRawLogs, employees, employeesTimekeeping, employeeShiftAssignments, employeeWeeklyShiftPatterns, payrollPeriods, payrollRuns } from "@/db/schema";
import { attendanceSourceEvents, attendanceSourceProjections, attendanceSourceMappings, attendanceSourceIdentities, attendanceResolutions } from "@/db/attendanceSourceSchema";
import { workTreatments, workExclusions, workSourceExclusions } from "@/db/attendanceWorkbenchSchema";
import type { AttendanceApprovedCorrectionRecord } from "./attendanceSync";
import { manilaWallTime, sourceDayOffset, type SourcePunch } from "./attendanceSourceClient";
import { sourceDayEligibility, buildAttendanceDayInput, freezesAttendanceInput, type AttendanceInputPunch } from "./attendanceDayInput";
import { resolveEmployeeScheduleForDate } from "./scheduleResolver";
import { groupLogsByEmployeeAndAttendanceDate, summarizeEmployeeDay, ATTENDANCE_SPLIT_SHIFT_INCOMPLETE_PUNCHES_FLAG } from "./attendance";
import { applyApprovedAttendanceCorrections } from "./attendanceCorrections";
import { resolutionDigest } from "./attendanceResolution";
import { adminDecision, attendanceEvidence, decisionIncomingRecords } from "./attendanceAdminDecision";
import type { WorkRecord } from "./attendanceWorkbenchModel";

type AttendanceScope = { employeeIds?: string[]; payrollPeriodId?: string; startDate: string; endDate: string };

/** One effective-input boundary for DTR refresh, reads and schedule-triggered rebuilds.
 * Recorded decisions remain authoritative even if a feature flag is later disabled.
 * The second predicate also protects duplicate source projections in a neighboring period.
 */
export function effectiveAttendanceRawPredicate() {
  return and(
    sql`not exists (select 1 from attendance_work_exclusions x where x.raw_log_id = ${attendanceRawLogs.id} and x.active)`,
    sql`(not exists (select 1 from attendance_work_treatments d where d.employee_id = ${attendanceRawLogs.employeeId} and d.day = ${attendanceRawLogs.logDate} and d.active and d.payload->>'kind' = 'AdminDecision')
      or exists (select 1 from attendance_work_raw_logs r join attendance_work_treatments d on d.plan_id = r.plan_id where r.raw_log_id = ${attendanceRawLogs.id} and d.employee_id = ${attendanceRawLogs.employeeId} and d.day = ${attendanceRawLogs.logDate} and d.active and d.payload->>'kind' = 'AdminDecision'))`,
  );
}

async function loadStoredEffectiveAttendanceRawLogs(database: DbClient, scope: AttendanceScope & { neighborDays?: "api" | "all" | "none" }) {
  if (scope.employeeIds?.length === 0) return [];
  const original = and(gte(attendanceRawLogs.logDate, scope.startDate), lte(attendanceRawLogs.logDate, scope.endDate));
  const neighbors = and(gte(attendanceRawLogs.logDate, sourceDayOffset(scope.startDate, -1)), lte(attendanceRawLogs.logDate, sourceDayOffset(scope.endDate, 1)));
  const dateFilter = scope.neighborDays === "all" ? neighbors : scope.neighborDays === "api" ? or(original, and(eq(attendanceImportBatches.sourceFormat, "API"), neighbors)) : original;
  const rows = await database.select({
    id: attendanceRawLogs.id, employeeId: attendanceRawLogs.employeeId, employeeNo: attendanceRawLogs.employeeNo,
    batchId: attendanceRawLogs.batchId, sourceFileName: attendanceImportBatches.sourceFileName,
    loggedAt: attendanceRawLogs.loggedAt, logDate: attendanceRawLogs.logDate, logTime: attendanceRawLogs.logTime,
    direction: attendanceRawLogs.direction, sourceLine: attendanceRawLogs.sourceLine, rawText: attendanceRawLogs.rawText,
    deviceId: attendanceRawLogs.deviceId, siteCode: attendanceRawLogs.siteCode, normalizedHash: attendanceRawLogs.normalizedHash,
  }).from(attendanceRawLogs).innerJoin(attendanceImportBatches, eq(attendanceRawLogs.batchId, attendanceImportBatches.id)).where(and(
    isNotNull(attendanceRawLogs.employeeId), scope.employeeIds ? inArray(attendanceRawLogs.employeeId, scope.employeeIds) : undefined,
    scope.payrollPeriodId ? eq(attendanceImportBatches.payrollPeriodId, scope.payrollPeriodId) : undefined,
    dateFilter, effectiveAttendanceRawPredicate(),
  )).orderBy(asc(attendanceRawLogs.employeeId), asc(attendanceRawLogs.loggedAt), asc(attendanceRawLogs.id));
  // A phone event may be projected into both periods for overnight context. Count
  // the same identified, unchanged capture once; distinct same-time captures stay.
  const seen = new Set<string>();
  return rows.filter(row => {
    let identity = row.normalizedHash;
    if (row.sourceFileName.startsWith("admin-decision:")) {
      try { const data = JSON.parse(row.rawText ?? "{}"); if (typeof data.recordId === "string") identity = `decision:${data.recordId}`; } catch { /* Keep the stored row identity if legacy text is not JSON. */ }
    }
    if (!identity) return true;
    const key = [row.employeeId, identity, row.logDate, row.logTime, row.direction].join("|");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export async function loadSourceDayEligibility(database:DbClient,records:SourcePunch[],employeeBySource:Map<string,{employeeId:string}>,scope?:{startDate:string;endDate:string}) {
 const ids=[...new Set([...employeeBySource.values()].map(row=>row.employeeId))];
 const dates=records.map(record=>manilaWallTime(record.capturedAt).date).sort(),from=sourceDayOffset(scope?.startDate??dates[0]??"1970-01-01",-1),through=scope?.endDate??dates.at(-1)??from;
 const [assignments,patterns,timekeeping]=ids.length?await Promise.all([
  database.select().from(employeeShiftAssignments).where(and(inArray(employeeShiftAssignments.employeeId,ids),lte(employeeShiftAssignments.effectiveFrom,through),or(sql`${employeeShiftAssignments.effectiveTo} is null`,gte(employeeShiftAssignments.effectiveTo,from)))),
  database.query.employeeWeeklyShiftPatterns.findMany({where:and(inArray(employeeWeeklyShiftPatterns.employeeId,ids),lte(employeeWeeklyShiftPatterns.effectiveFrom,through),or(sql`${employeeWeeklyShiftPatterns.effectiveTo} is null`,gte(employeeWeeklyShiftPatterns.effectiveTo,from))),with:{days:true}}),
  database.select().from(employeesTimekeeping).where(inArray(employeesTimekeeping.employeeId,ids)),
 ]):[[],[],[]];
 const scheduleFor=(employeeId:string,day:string)=>resolveEmployeeScheduleForDate({attendanceDate:day,assignments:assignments.filter(row=>row.employeeId===employeeId),weeklyPatterns:patterns.filter(row=>row.employeeId===employeeId),legacyTimekeeping:timekeeping.find(row=>row.employeeId===employeeId)??null}).shiftWindow;
 return {eligibility:sourceDayEligibility(records,punch=>employeeBySource.get(punch.employeeId)?.employeeId??null,scheduleFor),scheduleFor};
}

/** Cached phone facts may precede their raw projection. Read eligible facts in
 * memory so a complete day is immediately consistent across editors/calculation.
 * Existing approved or frozen payroll inputs are never expanded by this reader. */
export async function loadEffectiveAttendanceInputSet(database:DbClient,scope:AttendanceScope & {neighborDays?:"api"|"all"|"none"}) {
 const logs=await loadStoredEffectiveAttendanceRawLogs(database,scope);
 const from=sourceDayOffset(scope.startDate,-1),through=sourceDayOffset(scope.endDate,1);
 if(scope.employeeIds?.length===0)return {logs,punches:[] as Array<AttendanceInputPunch&{employeeId:string;day:string}>,lateConflicts:[] as string[],sourceIssues:[] as Array<{key:string;message:string}>,splitIncompleteDays:[] as string[],correctedDays:[] as string[]};
 const [sourceRows,treatments,excluded,sourceExcluded,periodRows,legacyDecisions,corrections]=await Promise.all([
  database.select({payload:attendanceSourceEvents.payload,employeeId:attendanceSourceMappings.employeeId,employeeNo:employees.employeeNo,rawLogId:attendanceSourceProjections.rawLogId,projectedEmployeeId:attendanceSourceProjections.employeeId,classification:attendanceSourceIdentities.classification}).from(attendanceSourceEvents)
   .innerJoin(attendanceSourceProjections,eq(attendanceSourceProjections.eventId,attendanceSourceEvents.eventId)).innerJoin(attendanceSourceMappings,eq(attendanceSourceMappings.sourceEmployeeId,attendanceSourceEvents.sourceEmployeeId)).innerJoin(employees,eq(employees.id,attendanceSourceMappings.employeeId)).leftJoin(attendanceSourceIdentities,eq(attendanceSourceIdentities.sourceEmployeeId,attendanceSourceEvents.sourceEmployeeId))
   .where(and(gte(attendanceSourceEvents.capturedAt,new Date(`${from}T00:00:00+08:00`)),lte(attendanceSourceEvents.capturedAt,new Date(`${through}T23:59:59.999+08:00`)),scope.employeeIds?inArray(attendanceSourceMappings.employeeId,scope.employeeIds):undefined,scope.payrollPeriodId?eq(attendanceSourceProjections.payrollPeriodId,scope.payrollPeriodId):undefined)),
  database.select().from(workTreatments).where(and(eq(workTreatments.active,true),gte(workTreatments.day,from),lte(workTreatments.day,through),scope.employeeIds?inArray(workTreatments.employeeId,scope.employeeIds):undefined,sql`${workTreatments.payload}->>'kind'='AdminDecision'`)),
  database.select({rawLogId:workExclusions.rawLogId}).from(workExclusions).innerJoin(attendanceRawLogs,eq(attendanceRawLogs.id,workExclusions.rawLogId)).where(and(eq(workExclusions.active,true),gte(attendanceRawLogs.logDate,from),lte(attendanceRawLogs.logDate,through),scope.employeeIds?inArray(attendanceRawLogs.employeeId,scope.employeeIds):undefined)),
  database.select({eventId:workSourceExclusions.eventId,version:workSourceExclusions.version}).from(workSourceExclusions).innerJoin(attendanceSourceEvents,eq(attendanceSourceEvents.eventId,workSourceExclusions.eventId)).innerJoin(attendanceSourceMappings,eq(attendanceSourceMappings.sourceEmployeeId,attendanceSourceEvents.sourceEmployeeId)).where(and(eq(workSourceExclusions.active,true),gte(attendanceSourceEvents.capturedAt,new Date(`${from}T00:00:00+08:00`)),lte(attendanceSourceEvents.capturedAt,new Date(`${through}T23:59:59.999+08:00`)),scope.employeeIds?inArray(attendanceSourceMappings.employeeId,scope.employeeIds):undefined)),
  database.select({period:{id:payrollPeriods.id,startDate:payrollPeriods.startDate,endDate:payrollPeriods.endDate,status:payrollPeriods.status},run:{id:payrollRuns.id,status:payrollRuns.status,payrollGroup:sql<string|null>`${payrollRuns.inputSnapshot}->>'payrollGroup'`}}).from(payrollPeriods).leftJoin(payrollRuns,eq(payrollRuns.payrollPeriodId,payrollPeriods.id)).where(and(lte(payrollPeriods.startDate,through),gte(payrollPeriods.endDate,from))),
  database.select({employeeId:attendanceResolutions.employeeId,payrollPeriodId:attendanceResolutions.payrollPeriodId}).from(attendanceResolutions).innerJoin(payrollPeriods,eq(payrollPeriods.id,attendanceResolutions.payrollPeriodId)).where(and(eq(attendanceResolutions.state,"Approved"),eq(attendanceResolutions.kind,"NoAttendance"),lte(payrollPeriods.startDate,through),gte(payrollPeriods.endDate,from),scope.employeeIds?inArray(attendanceResolutions.employeeId,scope.employeeIds):undefined)),
  loadEffectiveAttendanceCorrections(database,{...scope,startDate:from,endDate:through}),
 ]);
 const source=[...new Map(sourceRows.map(row=>[(row.payload as SourcePunch).eventId,row])).values()];
 const mapping=new Map([...logs.map(row=>[`raw:${row.employeeId}`,{employeeId:row.employeeId!}] as const),...source.map(row=>[(row.payload as SourcePunch).employeeId,{employeeId:row.employeeId}] as const)]);
 const {eligibility,scheduleFor}=await loadSourceDayEligibility(database,source.map(row=>row.payload as SourcePunch),mapping,{startDate:from,endDate:through});
 const protectedDay=(employeeId:string,day:string)=>treatments.some(row=>row.employeeId===employeeId&&row.day===day)||periodRows.some(({period,run})=>period.startDate<=day&&period.endDate>=day&&(period.status!=="Open"||run&&freezesAttendanceInput(run.status,run.payrollGroup)||legacyDecisions.some(row=>row.employeeId===employeeId&&row.payrollPeriodId===period.id)));
 const identityFor=(row:typeof logs[number])=>{try{const data=JSON.parse(row.rawText??"{}");return typeof data.recordId==="string"?data.recordId:typeof data.eventId==="string"?data.eventId:`raw:${row.id}`;}catch{return `raw:${row.id}`;}};
 const existing=new Map(logs.map(row=>[identityFor(row),row]));
 const held:Array<AttendanceInputPunch&{employeeId:string;day:string}>=[];
 const incomingRecords:WorkRecord[]=source.map(row=>{const p=row.payload as SourcePunch;return {id:p.eventId,source:"API",employeeId:row.employeeId,type:p.type,at:p.capturedAt,status:p.status,clockFlag:p.clockFlag,clockVerified:p.clockVerified,excluded:sourceExcluded.some(item=>item.eventId===p.eventId&&item.version===resolutionDigest(p))};});
 const lateConflicts:string[]=[];
 const reviewedSources=new Map<string,{record:WorkRecord;source:WorkRecord}>();
 const sourceIssues:Array<{key:string;message:string}>=[];
 for(const treatment of treatments){
  const decision=adminDecision(treatment.payload);if(!decision)continue;
  const incoming=decisionIncomingRecords(incomingRecords.filter(row=>row.employeeId===treatment.employeeId),decision),incomingDigest=resolutionDigest(attendanceEvidence(incoming));
  if(incomingDigest!==decision.keptIncomingDigest&&incomingDigest!==resolutionDigest(attendanceEvidence(decision.sourceRecords))&&incomingDigest!==resolutionDigest(attendanceEvidence(decision.records)))lateConflicts.push(`${treatment.employeeId}|${treatment.day}`);
  else for(const record of [...decision.sourceRecords,...decision.records])reviewedSources.set(`${treatment.employeeId}|${record.id}`,{record,source:decision.sourceRecords.find(row=>row.id===record.id)??record});
 }
 for(const row of source){
  const punch=row.payload as SourcePunch,wall=manilaWallTime(punch.capturedAt),entry=eligibility.get(punch.eventId)!;
  const reviewed=reviewedSources.get(`${row.employeeId}|${punch.eventId}`),identityChanged=!!row.projectedEmployeeId&&row.projectedEmployeeId!==row.employeeId;
  // The financial evidence digest intentionally omits phone warning metadata.
  // New safety findings must therefore also be compared with the exact source
  // snapshot reviewed by the administrator, without reopening unchanged flags.
  const newClockWarning=!!reviewed&&punch.clockFlag&&!punch.clockVerified&&(!reviewed.source.clockFlag||!!reviewed.source.clockVerified);
  const newSourceWarning=!!reviewed&&!!entry.reason&&!punch.reviewResolved&&punch.reviewFlags.some(flag=>!reviewed.source.sourcePunch?.reviewFlags.includes(flag)||reviewed.source.sourcePunch?.reviewResolved);
  const newReviewReason=identityChanged?"Employee identity mapping changed; review the assignment":row.classification==="TestOnly"?"Employee identity is marked test-only":newClockWarning?"Device clock needs verification":newSourceWarning?entry.reason:null;
  if(reviewed&&newReviewReason){const key=`${row.employeeId}|${entry.day}`;lateConflicts.push(key);sourceIssues.push({key,message:newReviewReason});}
  const prior=existing.get(punch.eventId);
  if(prior){
   // A later safety/identity finding on an open input must be visible immediately,
   // even before the next sync replaces its projection. Compare only review facts;
   // device/audit metadata alone cannot change payable input. Explicit decisions
   // and reviewed/posted snapshots retain their exact imported capture.
   if(!protectedDay(row.employeeId,entry.day)&&!protectedDay(prior.employeeId!,prior.logDate)){
    let imported:SourcePunch|null=null;try{const data=JSON.parse(prior.rawText??"{}");if(data.eventId===punch.eventId)imported=data as SourcePunch;}catch{/* Manual decision/file records are not source revisions. */}
    const reviewFacts=(value:SourcePunch)=>[value.employeeId,value.type,value.capturedAt,value.status,!!value.clockFlag,!!value.clockVerified,!!value.reviewResolved,[...value.reviewFlags].sort()];
    const changed=imported&&resolutionDigest(reviewFacts(imported))!==resolutionDigest(reviewFacts(punch));
    const reason=row.projectedEmployeeId&&row.projectedEmployeeId!==row.employeeId?"Employee identity mapping changed; review the assignment":row.classification==="TestOnly"?"Employee identity is marked test-only":changed&&!entry.eligible?entry.reason:null;
    if(reason){for(let index=logs.length-1;index>=0;index--)if(identityFor(logs[index])===punch.eventId)logs.splice(index,1);existing.delete(punch.eventId);held.push({employeeId:row.employeeId,day:entry.day,id:punch.eventId,type:punch.type,at:punch.capturedAt,included:false,reason,evidenceState:"pending"});}
   }
   continue;
  }
  const excludedCapture=row.rawLogId!=null&&excluded.some(item=>item.rawLogId===row.rawLogId)||sourceExcluded.some(item=>item.eventId===punch.eventId&&item.version===resolutionDigest(punch));
  const fileOverlap=logs.some(log=>log.employeeId===row.employeeId&&log.logDate===wall.date&&!log.sourceFileName.startsWith("attendance-api:")&&!log.sourceFileName.startsWith("admin-decision:"));
  const resolved=!!reviewed&&!newReviewReason&&row.classification!=="TestOnly";
  const reason=identityChanged?"Employee identity mapping changed; review the assignment":excludedCapture?"Excluded by an administrator":row.classification==="TestOnly"?"Employee identity is marked test-only":protectedDay(row.employeeId,entry.day)?"Approved attendance or payroll input retained; review incoming evidence explicitly":fileOverlap?"Overlapping file attendance needs review":entry.reason;
  if(reason){
   // Classification changes findings only, never the existing payroll inclusion
   // boundary. Reviewed event identities are informational only while the exact
   // incoming evidence still matches the approval.
   const displayReason=newReviewReason??(punch.status==="VOID"?"Voided source capture":resolved?(reviewed.record.status==="VOID"?"Voided by approved attendance decision":reviewed.record.excluded?"Excluded by approved attendance decision":"Original capture retained as approved attendance history"):reason);
   held.push({employeeId:row.employeeId,day:entry.day,id:punch.eventId,type:punch.type,at:punch.capturedAt,included:false,reason:displayReason,evidenceState:identityChanged?"pending":punch.status==="VOID"?"voided":resolved?"resolved":excludedCapture?"excluded":"pending"});continue;
  }
  if(scope.neighborDays!=="all"&&scope.neighborDays!=="api"&&(wall.date<scope.startDate||wall.date>scope.endDate))continue;
  const virtual={id:-parseInt(punch.eventId.replaceAll("-","").slice(0,7),16)-1,employeeId:row.employeeId,employeeNo:row.employeeNo,batchId:"cached-source",sourceFileName:"attendance-api:cached-source",loggedAt:new Date(`${wall.timestamp.replace(" ","T")}Z`),logDate:wall.date,logTime:wall.time,direction:punch.type,sourceLine:0,rawText:JSON.stringify(punch),deviceId:punch.deviceId??null,siteCode:punch.branchId,normalizedHash:resolutionDigest(["attendance-api",punch.eventId])};
  logs.push(virtual);existing.set(punch.eventId,virtual);
 }
 const groups=groupLogsByEmployeeAndAttendanceDate(logs.map(log=>({...log,rawLogId:log.id>0?log.id:null,sourceLine:log.sourceLine??0,rawText:log.rawText??""})),(log,day)=>scheduleFor(log.employeeId!,day));
 const punches:Array<AttendanceInputPunch&{employeeId:string;day:string}>=[];
 const correctedDays:string[]=[];
 // Only the display/finding projection applies old DTR corrections here. The
 // returned logs remain untouched: payroll already applies these corrections.
 for(const correction of corrections){const key=`${correction.employeeId}|${correction.attendanceDate}`;if(!groups.has(key))groups.set(key,[]);}
 for(const [key,group] of groups){
  const [employeeId,day]=key.split("|"),dayCorrections=corrections.filter(row=>row.employeeId===employeeId&&row.attendanceDate===day);
  const effective=applyApprovedAttendanceCorrections(group,dayCorrections);
  if(effective.length!==group.length||group.some(row=>!effective.includes(row)))correctedDays.push(key);
  for(const log of group.filter(row=>!effective.includes(row))){const row=log as typeof logs[number];punches.push({employeeId,day,id:identityFor(row),type:row.direction,at:new Date(`${row.logDate}T${row.logTime}+08:00`).toISOString(),included:false,reason:"Original capture retained as approved correction history",evidenceState:"resolved"});}
  for(const [index,log] of effective.entries()){
   const row=log as typeof logs[number],id=typeof row.id==="number"?identityFor(row):`correction:${key}:${index}`;
   punches.push({employeeId,day,id,type:log.direction,at:new Date(`${log.logDate}T${log.logTime}+08:00`).toISOString(),included:true,reason:null,evidenceState:"effective"});
  }
 }
 punches.push(...held);
 const splitIncompleteDays:string[]=[];
 const includedByDay=new Map<string,typeof punches>();
 for(const punch of punches){if(!punch.included)continue;const key=`${punch.employeeId}|${punch.day}`,list=includedByDay.get(key)??[];list.push(punch);includedByDay.set(key,list);}
 for(const [key,dayPunches] of includedByDay){
  const [employeeId,day]=key.split("|"),schedule=scheduleFor(employeeId,day);if(schedule?.punchPolicy!=="split_gaps")continue;
  const effective=dayPunches.map(punch=>{const wall=manilaWallTime(punch.at);return {employeeId,employeeNo:"",logDate:wall.date,logTime:wall.time,loggedAt:new Date(`${wall.timestamp.replace(" ","T")}Z`),direction:punch.type,sourceLine:0,rawText:""};});
  if(summarizeEmployeeDay(day,effective,schedule).anomalyFlags.includes(ATTENDANCE_SPLIT_SHIFT_INCOMPLETE_PUNCHES_FLAG))splitIncompleteDays.push(key);
 }
 return {logs,punches,lateConflicts:[...new Set(lateConflicts)],sourceIssues,splitIncompleteDays,correctedDays};
}

export async function loadEffectiveAttendanceRawLogs(database:DbClient,scope:AttendanceScope & {neighborDays?:"api"|"all"|"none"}) {return (await loadEffectiveAttendanceInputSet(database,scope)).logs;}
export function attendanceInputForDay(input:Awaited<ReturnType<typeof loadEffectiveAttendanceInputSet>>,employeeId:string,day:string){
 const view=buildAttendanceDayInput(input.punches.filter(punch=>punch.employeeId===employeeId&&punch.day===day)),key=`${employeeId}|${day}`;
 view.issues=[...new Set([...view.issues,...input.sourceIssues.filter(row=>row.key===key).map(row=>row.message)])];
 if(input.splitIncompleteDays.includes(key)){view.complete=false;view.canConfirmExisting=false;view.issues.push("Required split-break OUT/IN pair missing");}
 return input.lateConflicts.includes(key)?{...view,lateConflict:true,canConfirmExisting:false,issues:[...view.issues,"Incoming attendance differs — approved decision retained. Review incoming evidence explicitly."]}:view;
}

export async function loadEffectiveAttendanceCorrections(database: DbClient, scope: AttendanceScope) {
  if (scope.employeeIds?.length === 0) return [];
  return database.select().from(attendanceDtrCorrections).where(and(
    scope.payrollPeriodId ? eq(attendanceDtrCorrections.payrollPeriodId, scope.payrollPeriodId) : undefined,
    scope.employeeIds ? inArray(attendanceDtrCorrections.employeeId, scope.employeeIds) : undefined,
    eq(attendanceDtrCorrections.status, "Approved"), gte(attendanceDtrCorrections.attendanceDate, scope.startDate), lte(attendanceDtrCorrections.attendanceDate, scope.endDate),
    sql`not exists (select 1 from attendance_work_treatments d where d.employee_id = ${attendanceDtrCorrections.employeeId} and d.day = ${attendanceDtrCorrections.attendanceDate} and d.active and d.payload->>'kind' = 'AdminDecision')`,
  ));
}

export function mapEffectiveAttendanceCorrections(rows: Array<typeof attendanceDtrCorrections.$inferSelect>): AttendanceApprovedCorrectionRecord[] {
  return rows.map(({ employeeId, attendanceDate, correctionType, payload }) => ({ employeeId, attendanceDate, correctionType, payload }));
}
