import { deliverySummary, affectedWorkDates } from "./attendanceStage6Model";
import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, desc, gte, lte, isNull, inArray, sql } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { employees, employeesGeneralInfo, employeesTimekeeping, employeeShiftAssignments, employeeWeeklyShiftPatterns, employeeWeeklyShiftPatternDays, employeesLeaveRecords, employeeLeaveRecordDays, payrollPeriods, payrollRuns, attendanceRawLogs, attendanceImportBatches } from "@/db/schema";
import { attendanceSourceMappings as mappings, attendanceSourceEvents as events, attendanceSourceProjections as projections, attendanceSourceIdentities as identities } from "@/db/attendanceSourceSchema";
import { workBatches, workPlans, workTreatments, workHistory, adjustmentCases, workRawLogs, workExclusions, workSourceExclusions } from "@/db/attendanceWorkbenchSchema";
import { resolutionDigest, loadAttendanceReadiness, invalidateResolutionPeriod } from "./attendanceResolution";
import { resolveEmployeeScheduleForDate, isResolvedScheduleRestDay, scheduleVersionRecord } from "./scheduleResolver";
import { manilaWallTime, sourceDayOffset, type SourcePunch } from "./attendanceSourceClient";
import { type WorkBoard, type WorkDraft, type WorkRecord, type WorkEmployee, type WorkDay, simulateWork, sequenceProblems, suggestionsForDay, dayStatus, workDate, localToInstant, draftVersion, draftRecords, workDayRecords, changeInputErrors, canCorrectRecord, dayNeedsReview } from "./attendanceWorkbenchModel";
import { lockAttendancePayrollInput } from "./attendanceSourceGuard";
import { PayrollValidationError } from "./validation";
import { attendanceSchedulerActorAuthorized } from "./attendanceSourceActor";
import { summarizeEmployeeDay } from "./attendance";
import { adminDecision, applyAdminDecisions, attendanceEvidence, decisionIncomingRecords } from "./attendanceAdminDecision";
import { loadWorkProgress } from "./attendanceWorkProgress";
import { persistAdminDecision } from "./attendanceAdminDecisionStore";

export const workbenchEnabled=()=>process.env.ATTENDANCE_WORKBENCH_ENABLED==="true";
function fail(message:string):never {throw new PayrollValidationError(message);}
const wireText=(value:string,limit:number)=>value.replace(/\s+/g," ").trim().slice(0,limit);
function enabled(){if(!workbenchEnabled())fail("The new attendance workflow is not activated.");}
const idPattern=/^[0-9a-f-]{36}$/i;
const activeStates=["Approved","Applying","Sync pending","Failed"];
export { draftVersion, workDayRecords } from "./attendanceWorkbenchModel";
export async function workEmployees(periodId:string,database:DbClient=db,incoming?:SourcePunch[],now=new Date().toISOString(),employeeId?:string):Promise<WorkEmployee[]> {
 const [period]=await database.select().from(payrollPeriods).where(eq(payrollPeriods.id,periodId));if(!period)fail("Payroll period not found.");
 const [roster,links,identity,source,raw,timekeeping,assignments,patterns,patternDays,leaves,leaveDays,treatments,excluded,manualLinks,sourceExcluded,periodRuns,keptSnapshots]=await Promise.all([
  database.select({person:employees,info:employeesGeneralInfo}).from(employees).leftJoin(employeesGeneralInfo,eq(employeesGeneralInfo.employeeId,employees.id)).where(and(isNull(employees.deletedAt),eq(employees.employeeType,"EMP"),employeeId?eq(employees.id,employeeId):undefined)),
  database.select().from(mappings),database.select().from(identities),incoming?Promise.resolve(incoming):database.select({payload:events.payload}).from(projections).innerJoin(events,eq(events.eventId,projections.eventId)).where(eq(projections.payrollPeriodId,periodId)).then(r=>r.map(x=>x.payload as SourcePunch)),
  database.select({log:attendanceRawLogs,format:attendanceImportBatches.sourceFormat}).from(attendanceRawLogs).innerJoin(attendanceImportBatches,eq(attendanceImportBatches.id,attendanceRawLogs.batchId)).where(eq(attendanceImportBatches.payrollPeriodId,periodId)),
  database.select().from(employeesTimekeeping),database.select().from(employeeShiftAssignments),database.select().from(employeeWeeklyShiftPatterns),database.select().from(employeeWeeklyShiftPatternDays),
  database.select().from(employeesLeaveRecords).where(and(eq(employeesLeaveRecords.leaveStatus,"Approved"),isNull(employeesLeaveRecords.deletedAt))),database.select().from(employeeLeaveRecordDays),database.select().from(workTreatments).where(and(eq(workTreatments.periodId,periodId),eq(workTreatments.active,true))),database.select().from(workExclusions).where(eq(workExclusions.active,true)),database.select().from(workRawLogs),database.select().from(workSourceExclusions).where(and(eq(workSourceExclusions.periodId,periodId),eq(workSourceExclusions.active,true))),
  database.select().from(payrollRuns).where(eq(payrollRuns.payrollPeriodId,periodId)).orderBy(desc(payrollRuns.createdAt)),
  database.select().from(workHistory).where(and(eq(workHistory.action,"Kept payroll attendance"),sql`${workHistory.details}->>'periodId'=${periodId}`)),
 ]);
 const frozenRun=periodRuns.find(r=>r.status!=="Void"&&r.inputSnapshot?.payrollGroup!=="Monthly");
 return roster.filter(({info})=>!info?.dateHired||info.dateHired<=period.endDate).filter(({info})=>!info?.separationDate||info.separationDate>=period.startDate).filter(({info})=>!info||!["Resigned","Terminated","Finished Conctract"].includes(info.employmentStatus??"")||!!info.separationDate).map(({person,info})=>{
  const employeeLinks=links.filter(m=>m.employeeId===person.id&&!identity.some(i=>i.sourceEmployeeId===m.sourceEmployeeId&&i.classification==="TestOnly")),sourceIds=employeeLinks.map(m=>m.sourceEmployeeId);
  let records:WorkRecord[]=source.filter(p=>sourceIds.includes(p.employeeId)).map(p=>({id:p.eventId,source:"API",employeeId:person.id,type:p.type,at:p.capturedAt,status:p.status,clockFlag:p.clockFlag,clockVerified:p.clockVerified,originalType:p.originalType??p.type,originalAt:p.originalCapturedAt??p.capturedAt,sourceEmployeeId:p.employeeId,sourcePunch:p,excluded:sourceExcluded.some(x=>x.eventId===p.eventId&&x.version===resolutionDigest(p))}));
  for(const {log,format} of raw.filter(r=>r.log.employeeId===person.id)) {
   if(log.rawText?.includes('"ADMIN_DECISION"'))continue;
   const managed=manualLinks.find(x=>x.rawLogId===log.id);
   if(format==="API"&&!managed&&!log.rawText?.includes('"MANUAL_DTR"'))continue;
   records.push({id:`raw:${log.id}`,rawLogId:log.id,source:managed||format==="API"?"Manual":"File",employeeId:person.id,type:log.direction,at:new Date(`${log.logDate}T${log.logTime}+08:00`).toISOString(),status:"VALID",clockFlag:false,excluded:excluded.some(x=>x.rawLogId===log.id)});
  }
  const incomingRecords=records;
  // A computed payroll holds its imported input until the admin explicitly
  // adopts new evidence. Raw captures retain the exact source revision used.
  if(frozenRun){
   const held:WorkRecord[]=raw.filter(r=>r.log.employeeId===person.id&&r.format==="API").flatMap(({log})=>{
    let p:SourcePunch;try{p=JSON.parse(log.rawText??"{}");}catch{return [];}
    if(!p.eventId||!p.capturedAt||!p.employeeId)return [];
    return [{id:p.eventId,rawLogId:log.id,source:"API" as const,employeeId:person.id,type:log.direction,at:new Date(`${log.logDate}T${log.logTime}+08:00`).toISOString(),status:p.status,clockFlag:p.clockFlag,clockVerified:p.clockVerified,originalType:p.originalType??p.type,originalAt:p.originalCapturedAt??p.capturedAt,sourceEmployeeId:p.employeeId,sourcePunch:p,excluded:excluded.some(x=>x.rawLogId===log.id)||sourceExcluded.some(x=>x.eventId===p.eventId)}];
   });
   records=[...held,...records.filter(r=>r.source!=="API")];
  }
  const snapshots=[...new Map(treatments.filter(t=>t.employeeId===person.id).sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()).flatMap(t=>{const d=adminDecision(t.payload);return d?[[t.planId,d] as const]:[];})).values()];
  records=applyAdminDecisions(records,snapshots);
  const days:WorkDay[]=[];
  for(let day=period.startDate;day<=period.endDate;day=sourceDayOffset(day,1)) {
   if(info?.dateHired&&day<info.dateHired||info?.separationDate&&day>info.separationDate)continue;
   const resolved=resolveEmployeeScheduleForDate({attendanceDate:day,assignments:assignments.filter(a=>a.employeeId===person.id),weeklyPatterns:patterns.filter(p=>p.employeeId===person.id).map(p=>({...p,days:patternDays.filter(d=>d.patternId===p.id)})),legacyTimekeeping:timekeeping.find(t=>t.employeeId===person.id)??null});
   const schedule=resolved.configured?resolved.shiftWindow:null;
   const dayLeaves=leaves.filter(l=>l.employeeId===person.id&&l.leaveStartDate&&l.leaveStartDate<=day&&l.leaveEndDate&&l.leaveEndDate>=day);
   const leave=dayLeaves.reduce((n,l)=>{const detail=leaveDays.find(d=>d.leaveRecordId===l.id&&d.leaveDate===day);return n+(detail?Number(detail.quantity):0)*(schedule?.hoursPerDay??0)*60;},0);
   const own=workDayRecords(records,day),context=records.filter(r=>workDate(r.at)>=sourceDayOffset(day,-1)&&workDate(r.at)<=sourceDayOffset(day,1));
   const configuration={schedule,source:resolved.source,assignment:scheduleVersionRecord(resolved.overrideAssignment),pattern:scheduleVersionRecord(resolved.weeklyPatternDay),employment:info?{hired:info.dateHired,separated:info.separationDate,status:info.employmentStatus}:null};
   const leaveEvidence=dayLeaves.map(l=>({record:l,detail:leaveDays.filter(d=>d.leaveRecordId===l.id&&d.leaveDate===day)}));
   const version=resolutionDigest([configuration,leaveEvidence,employeeLinks,identity.filter(i=>sourceIds.includes(i.sourceEmployeeId)),context]);
   const treatment=treatments.find(t=>t.employeeId===person.id&&t.day===day&&(adminDecision(t.payload)||t.version===version));
   const status=dayStatus({day,schedule,rest:isResolvedScheduleRestDay(resolved),leave,records:own,now});
   const issues=status==="Future"||status==="In progress / awaiting upload"||status==="Rest day"||status==="Approved leave"?[]:sequenceProblems(own,schedule).errors;
   for(const record of own.filter(r=>r.source==="API"&&!r.excluded&&r.status==="VALID"&&!r.sourcePunch?.reviewResolved))if(record.sourcePunch?.reviewFlags.length)issues.push("Review source warnings: "+record.sourcePunch.reviewFlags.join(", "));
   if(status==="Schedule missing"&&own.length)issues.push("Schedule missing; uncalculable time contributes no attendance-based work");
   if(!sourceIds.length&&own.some(r=>r.source==="API"))issues.push("Verify an attendance employee mapping");
   if(own.some(r=>r.source==="API")&&own.some(r=>r.source==="File"&&!r.excluded))issues.push("Choose between overlapping API and file punches");
   if(own.some(r=>r.source==="API")&&own.some(r=>r.source==="Manual"&&!r.excluded))issues.push("Compare original and manual evidence; prevent duplicate time");
   if(dayLeaves.some(l=>!leaveDays.some(d=>d.leaveRecordId===l.id&&d.leaveDate===day)))issues.push("Review missing leave day details in Leave");
   if(treatment)issues.length=0;
   const decision=adminDecision(treatment?.payload),incomingForDecision=decision?decisionIncomingRecords(incomingRecords,decision):frozenRun?workDayRecords(incomingRecords,day):[];
   const incomingDigest=resolutionDigest(attendanceEvidence(incomingForDecision));
   const keptSnapshot=keptSnapshots.some(h=>{const d=h.details as Record<string,unknown>;return d.employeeId===person.id&&d.day===day&&d.payrollRunId===frozenRun?.id&&d.incomingDigest===incomingDigest;});
   const lateConflict=decision?incomingDigest!==decision.keptIncomingDigest&&incomingDigest!==resolutionDigest(attendanceEvidence(decision.sourceRecords))&&incomingDigest!==resolutionDigest(attendanceEvidence(decision.records)):!!frozenRun&&!keptSnapshot&&incomingDigest!==resolutionDigest(attendanceEvidence(own));
   if(lateConflict)issues.push(decision?"Late upload differs — approved attendance retained":"Incoming attendance differs — payroll input retained");
   const decisionView:WorkDay["decision"]=decision?{planId:treatment!.planId,revision:treatment!.version,approvedAt:decision.approvedAt,reason:decision.reason,lateConflict,incomingDigest,incomingRecords:incomingForDecision}:frozenRun?{payrollRunId:frozenRun.id,approvedAt:(frozenRun.computedAt??frozenRun.createdAt).toISOString(),reason:"Attendance input retained from the payroll computation",lateConflict,incomingDigest,incomingRecords:incomingForDecision}:undefined;
   days.push({day,schedule,rest:isResolvedScheduleRestDay(resolved),leave,leaveEvidence,configuration,records:own,status:!["Future","In progress / awaiting upload","Rest day","Approved leave"].includes(status)&&!own.some(r=>r.status==="VALID"&&!r.excluded)&&!leave?"No work recorded":status,issues:[...new Set(issues)],findings:[...new Set(issues)].map(message=>({code:message.startsWith("Late upload")||message.startsWith("Incoming attendance")?"LATE_CONFLICT":"ATTENDANCE_WARNING",severity:"warning" as const,employeeId:person.id,day,message})),suggestions:treatment||!own.length?[]:suggestionsForDay(day,own,schedule),version,resolved:!!treatment,...(decisionView?{decision:decisionView}:{})});
  }
  return {id:person.id,no:person.employeeNo,name:[person.firstName,person.middleName,person.lastName].filter(Boolean).join(" "),sourceIds,mappingEvidence:employeeLinks,hired:info?.dateHired??null,separated:info?.separationDate??null,days,contextRecords:records};
 }).sort((a,b)=>a.no.localeCompare(b.no));
}
export function previewWork(employee:WorkEmployee,draft:WorkDraft,sharedRecords?:WorkRecord[],sharedChanges?:WorkDraft["changes"]) {
 const context=sharedRecords??draftRecords(employee,draft);
 const simulated=simulateWork(context,(sharedChanges??draft.changes).filter(c=>!c.employeeId||c.employeeId===employee.id||c.targetEmployeeId===employee.id),employee.id),errors=[...simulated.errors],warnings:string[]=[];
 if(Object.entries(draft.incomingVersions??{}).some(([day,version])=>employee.days.find(d=>d.day===day)?.decision?.incomingDigest!==version))errors.push("Incoming evidence changed. Review incoming attendance again.");
 for(const c of draft.changes) {
  if(!["Direction","Time","Employee","Void","Restore","Manual","ConfirmSequence","NoAttendance","Exclude","Retain","UndoCapture","ReopenDay"].includes(c.kind))errors.push("Unknown correction type");
  if(c.eventId||c.rawLogId!==undefined){const selected=context.find(r=>c.eventId?r.id===c.eventId:r.rawLogId===c.rawLogId);if(!selected||selected.employeeId!==employee.id)errors.push("A selected capture belongs to another employee. Review it in that employee's plan.");if(selected&&!canCorrectRecord(selected,c.kind))errors.push("This entry requires an explicit source selection and verified replacement.");}
  if(!draft.days.includes(c.day)||!employee.days.some(d=>d.day===c.day))errors.push("A change falls outside the reviewed workdays");
  errors.push(...changeInputErrors(draft,c));
  if(!c.verified)errors.push("Verify each selected change and supply its evidence and reason");
  if(c.kind==="Employee")warnings.push("Employee reassignment also affects the receiving employee; both must be included in batch review");
 }
 for(const day of draft.days) {
  const original=employee.days.find(d=>d.day===day);if(!original){errors.push("Workday is outside employee eligibility");continue;}
  const list=workDayRecords(simulated.records,day),check=sequenceProblems(list,original.schedule);
  if(draft.changes.some(c=>c.day===day&&c.kind==="ConfirmSequence")&&!list.some(r=>r.status==="VALID"&&!r.excluded))errors.push("There is no sequence to confirm. Add verified times or explicitly confirm no attendance.");
  if(draft.changes.some(c=>c.day===day&&["Manual","ConfirmSequence","NoAttendance"].includes(c.kind))) {
   if(!original.schedule?.checkInTime||!original.schedule.checkOutTime)warnings.push(`${day}: schedule missing; approval records attendance facts. Uncalculable time contributes no attendance-based work.`);
   if(draft.changes.some(c=>c.day===day&&c.kind==="NoAttendance")&&list.some(r=>r.status==="VALID"&&!r.excluded))errors.push("No-attendance confirmation requires no effective punches");
  }
  warnings.push(...check.warnings,...check.errors.map(e=>`Remaining: ${e}`));
 }
 return {...simulated,errors:[...new Set(errors)],warnings:[...new Set(warnings)],findings:[...errors.map(message=>({code:"INVALID_CORRECTION",severity:"error" as const,employeeId:employee.id,days:draft.days,message})),...warnings.map(message=>({code:"ATTENDANCE_WARNING",severity:"warning" as const,employeeId:employee.id,days:draft.days,message}))]};
}
export async function loadWorkBoard(periodId:string,database:DbClient=db):Promise<WorkBoard> {
 enabled();const [period]=await database.select().from(payrollPeriods).where(eq(payrollPeriods.id,periodId));if(!period)fail("Select a payroll period.");
 const [people,progress,readiness]=await Promise.all([workEmployees(periodId,database),loadWorkProgress(periodId,database),loadAttendanceReadiness(periodId,database,0,false)]);
 const {plans}=progress;
 for(const plan of plans.filter(p=>p.state==="Rejected")){const draft=plan.draft as WorkDraft,person=people.find(p=>p.id===draft.employeeId);if(person&&draft.version===draftVersion(person,draft.days))for(const day of person.days.filter(d=>draft.days.includes(d.day)))day.suggestions=[];}
 return {period:{id:period.id,code:period.code,startDate:period.startDate,endDate:period.endDate,posted:!readiness.periodOpen},employees:people,...progress,statuses:{sync:readiness.needsSync?"Sync required":"Up to date",review:people.some(e=>e.days.some(dayNeedsReview))?"Needs review":"Ready",delivery:deliverySummary(plans),dtr:readiness.summariesOutdated?"Refresh needed":"Up to date",payroll:readiness.periodOpen?"Recompute and review explicitly":"Posted / closed — adjustment required"},enabled:true};
}
async function history(database:DbClient,actor:string,planId:string|null,action:string,details:unknown){await database.insert(workHistory).values({actor,planId,action,details});}
export async function saveWorkDraft(database:DbClient,actor:string,periodId:string,drafts:WorkDraft[],existing?:{id:string;revision:number}) {
 enabled();if(!idPattern.test(periodId)||!Array.isArray(drafts)||!drafts.length||drafts.length>20||drafts.reduce((n,d)=>n+d.changes.length,0)>200||new Set(drafts.map(d=>d.employeeId)).size!==drafts.length)fail("Select 1–20 distinct employee plans and no more than 200 changes. Divide larger selections explicitly.");
 await lockAttendancePayrollInput(database);
 const people=await workEmployees(periodId,database);
 const sharedRecords=Array.from(new Map(drafts.flatMap(d=>{const p=people.find(p=>p.id===d.employeeId);return p?draftRecords(p,d):[];}).map(r=>[r.id,r])).values());
 const sharedChanges=drafts.flatMap(d=>d.changes.map(c=>({...c,employeeId:d.employeeId})));
 const id=existing?.id??randomUUID();
 if(existing){const [batch]=await database.select().from(workBatches).where(eq(workBatches.id,id)).for("update");if(!batch||batch.periodId!==periodId||batch.revision!==existing.revision||batch.state!=="Draft")fail("The saved batch changed. Reopen it before saving; your unsaved selections remain on screen.");await database.update(workBatches).set({revision:batch.revision+1,updatedAt:new Date()}).where(eq(workBatches.id,id));}
 else await database.insert(workBatches).values({id,periodId,actor});
 const old=await database.select().from(workPlans).where(eq(workPlans.batchId,id));
 for(const draft of drafts){
  const employee=people.find(p=>p.id===draft.employeeId);if(!employee)fail("An employee is no longer eligible for this period.");
  if(!draft.days.length||draft.days.some(d=>!employee.days.some(day=>day.day===d)))fail("Select eligible workdays.");
  if(draft.ownerId!==actor&&!await attendanceSchedulerActorAuthorized(database,draft.ownerId))fail("Assign an active administrator owner.");
  if(JSON.stringify(draft).length>100000)fail("Plan evidence is too long.");
  const previous=old.find(p=>p.employeeId===draft.employeeId),planId=previous?.id??randomUUID();
  const current=draftVersion(employee,draft.days),state=draft.version!==current?"Needs fresh review":draft.rejected?"Rejected":previewWork(employee,draft,sharedRecords,sharedChanges).errors.length||!draft.changes.length?"Needs evidence":"Ready for approval";
  const values={draft,state,evidenceVersion:draft.version,ownerId:draft.ownerId,updatedAt:new Date(),result:state==="Needs fresh review"?"Relevant attendance, mapping or schedule evidence changed. Review differences before approving.":null};
  if(previous&&!["Ready for approval","Needs evidence","Rejected","Needs fresh review","Removed from draft"].includes(previous.state))fail("This plan is already approved. Refresh the batch before saving.");
  if(previous)await database.update(workPlans).set(values).where(eq(workPlans.id,planId));else await database.insert(workPlans).values({...values,id:planId,batchId:id,periodId,employeeId:draft.employeeId});
  await history(database,actor,planId,"Draft saved",draft);
 }
 for(const removed of old.filter(p=>["Ready for approval","Needs evidence","Rejected","Needs fresh review"].includes(p.state)&&!drafts.some(d=>d.employeeId===p.employeeId)))await database.update(workPlans).set({state:"Removed from draft",updatedAt:new Date()}).where(eq(workPlans.id,removed.id));
 return {id,revision:(existing?.revision??0)+1};
}
type SourceContext={version:number;contextToken:string;uploadCoverage?:{state:string;through:string|null};records:{eventId:string;employeeId:string;employeeName:string;type:string;capturedAt:string;status:string;clockVerified:boolean;revision:string}[]};
export async function workSource(request:unknown,fetcher:typeof fetch=fetch):Promise<Record<string,unknown>> {
 const origin=new URL(process.env.ATTENDANCE_SOURCE_ORIGIN??"https://invalid.invalid");if(origin.protocol!=="https:"||origin.pathname!=="/"||origin.username||origin.password||origin.search||origin.hash)fail("Configure the HTTPS attendance origin.");
 const token=process.env.ATTENDANCE_CORRECTION_TOKEN??"";if(token.length<32)fail("The attendance correction connection is not configured.");
 const response=await fetcher(new URL("/v1/integra/corrections",origin),{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(request),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000)});
 if(response.status===409)fail("Source evidence changed. Review changed evidence before applying this plan.");if(!response.ok)fail(`Attendance delivery returned ${response.status}. Retry unfinished work; a previous request may already have succeeded.`);
 const body=await response.text();if(body.length>2000000)fail("Attendance response was too large.");return JSON.parse(body);
}
export async function prepareWorkApproval(periodId:string,batchId:string,revision:number,database:DbClient=db,fetcher:typeof fetch=fetch,selectedPlanIds?:string[]) {
 void fetcher;
 enabled();const [batch]=await database.select().from(workBatches).where(eq(workBatches.id,batchId));if(!batch||batch.periodId!==periodId||batch.revision!==revision||batch.state!=="Draft")fail("Reopen the current saved batch.");
 const people=await workEmployees(periodId,database),plans=(await database.select().from(workPlans).where(eq(workPlans.batchId,batchId))).filter(p=>selectedPlanIds?selectedPlanIds.includes(p.id):!["Removed from draft","Approved","Applying","Sync pending","Resolved"].includes(p.state));
 const sharedChanges=plans.flatMap(p=>(p.draft as WorkDraft).changes.map(c=>({...c,employeeId:p.employeeId})));
 const sharedRecords=Array.from(new Map(plans.flatMap(p=>{const e=people.find(e=>e.id===p.employeeId);return e?draftRecords(e,p.draft as WorkDraft):[];}).map(r=>[r.id,r])).values());
 if(!plans.length||plans.some(p=>p.state!=="Ready for approval"))fail("Every selected plan needs to be ready. No selected plans were skipped.");
 const prepared:{id:string;draft:WorkDraft;version:string;preview:ReturnType<typeof previewWork>;sourceRequest:Record<string,unknown>|null;impacts:string[];periodEvidence:{id:string;code:string;posted:boolean;days:WorkDay[];version:string}[]}[]=[];
 for(const plan of plans){const draft=plan.draft as WorkDraft,person=people.find(p=>p.id===plan.employeeId)!;
  if(!person||draft.version!==draftVersion(person,draft.days))fail("Relevant attendance, mapping or schedule evidence changed. Review the batch again.");
  const preview=previewWork(person,draft,sharedRecords,sharedChanges);if(preview.errors.length)fail(preview.errors.join(". "));
  const targets=draft.changes.filter(c=>c.kind==="Employee"||c.kind==="UndoCapture"&&c.targetEmployeeId&&c.targetEmployeeId!==person.id).map(c=>people.find(p=>p.id===c.targetEmployeeId));
  if(targets.some(t=>!t||t.sourceIds.length!==1||!plans.some(p=>p.employeeId===t.id)))fail("Employee reassignment requires a verified unique target identity and both employees in this batch.");
  const sourceChanges=draft.changes.filter(c=>c.eventId&&draftRecords(person,draft).some(r=>r.id===c.eventId&&r.source==="API")&&!["Exclude","Retain"].includes(c.kind));
  const affectedDates=affectedWorkDates(draft,sharedRecords);
  let sourceRequest:Record<string,unknown>|null=null;
  if(sourceChanges.length&&person.sourceIds.length){
   const employeeIds=[...new Set([...person.sourceIds,...targets.flatMap(t=>t!.sourceIds)])],from=sourceDayOffset(affectedDates[0],-1),through=sourceDayOffset(affectedDates.at(-1)!,1);
   const observedRecords=draftRecords(person,draft).filter(r=>r.source==="API"&&employeeIds.includes(r.sourceEmployeeId??"")&&workDate(r.at)>=from&&workDate(r.at)<=through);
   const context:SourceContext={version:1,contextToken:"",records:observedRecords.map(r=>({eventId:r.id,employeeId:person.days.flatMap(d=>d.decision?.incomingRecords??[]).find(x=>x.id===r.id&&x.type===r.type&&x.at===r.at&&x.status===r.status)?.sourceEmployeeId??r.sourceEmployeeId!,employeeName:person.name,type:r.type,capturedAt:r.at,status:r.status,clockVerified:!!r.clockVerified,revision:r.sourcePunch?.effectiveRevision??""}))};
   preview.warnings.push("Attendance source delivery is separate. Incoming uploads cannot override this payroll decision.");
   const wireChanges=sourceChanges.map(c=>({eventId:c.eventId,...(c.kind==="Direction"||c.kind==="UndoCapture"?{type:c.type}:{}),...(c.kind==="Time"||c.kind==="UndoCapture"?{capturedAt:localToInstant(c.at!)}:{}),...(c.kind==="Employee"||c.kind==="UndoCapture"?{employeeId:people.find(t=>t.id===(c.targetEmployeeId??person.id))!.sourceIds[0]}:{}),...(c.kind==="Void"||c.kind==="Restore"?{status:c.kind==="Void"?"VOID":"VALID"}:{}),...(c.kind==="UndoCapture"?{status:c.status,clockVerified:c.clockVerified}: {})}));
   const combined=Array.from(wireChanges.reduce((map,c)=>map.set(c.eventId!,{...map.get(c.eventId!),...c}),new Map<string,typeof wireChanges[number]>()).values());
   sourceRequest={operation:sourceChanges.length?"apply-plan":"verify-context",version:1,id:plan.id,employeeIds,from,through,reviewDays:affectedDates,contextToken:context.contextToken,_deferredContext:true,_context:context.records,actor:batch.actor,reason:wireText(draft.reason||draft.changes.map(c=>c.reason).join("; "),1200),evidence:wireText(draft.changes.map(c=>c.evidence).join("; "),2000),...(draft.undoOf?{undoOf:draft.undoOf}:{}),changes:combined};
  }
  const allPeriods=(await database.select().from(payrollPeriods).where(and(lte(payrollPeriods.startDate,sourceDayOffset(affectedDates.at(-1)!,1)),gte(payrollPeriods.endDate,sourceDayOffset(affectedDates[0],-1))))).filter(p=>affectedDates.some(day=>day>=sourceDayOffset(p.startDate,-1)&&day<=sourceDayOffset(p.endDate,1)));
  if(sourceRequest)sourceRequest._localEvidence={ [person.id]:resolutionDigest([person.mappingEvidence,person.days.filter(d=>draft.days.includes(d.day)).map(d=>[d.day,d.configuration,d.leaveEvidence])]) };
  for(const day of draft.changes.filter(c=>c.at).map(c=>c.at!.slice(0,10)))if(!allPeriods.some(p=>day>=p.startDate&&day<=p.endDate))fail(`Create the payroll period containing ${day} before approving a date change. Your draft is retained.`);
  const periodEvidence=[];
  for(const period of allPeriods){
   const scoped=(period.id===periodId?people:await workEmployees(period.id,database)).find(p=>p.id===person.id);
   if(!scoped){
    if(affectedDates.some(date=>date>=period.startDate&&date<=period.endDate))fail(`Employee is not eligible in affected period ${period.code}. Review employment dates before approval.`);
    continue; // Neighbor context alone does not extend employment eligibility.
   }
   for(const date of draft.changes.filter(c=>c.at).map(c=>c.at!.slice(0,10)))if(date>=period.startDate&&date<=period.endDate&&!scoped.days.some(d=>d.day===date))fail(`The corrected date ${date} is outside this employee's employment dates.`);
   const days=scoped.days.filter(d=>affectedDates.some(day=>Math.abs(Date.parse(d.day)-Date.parse(day))<=86400000));
   const runs=await database.select().from(payrollRuns).where(eq(payrollRuns.payrollPeriodId,period.id));
   const posted=period.status!=="Open"||runs.some(r=>r.status==="Posted"&&r.inputSnapshot?.payrollGroup!=="Monthly");
   periodEvidence.push({id:period.id,code:period.code,posted,days,version:resolutionDigest([scoped.mappingEvidence,days])});
   if(posted)preview.warnings.push(`${period.code}: posted payroll remains unchanged; a linked adjustment case is required.`);
   if(period.id!==periodId){
    const sourceContext=(sourceRequest?._context??[]) as SourceContext["records"];
    const sourceRecords:WorkRecord[]=sourceContext.filter(r=>scoped.sourceIds.includes(r.employeeId)).map(r=>({id:r.eventId,source:"API",employeeId:scoped.id,type:r.type as "IN"|"OUT",at:r.capturedAt,status:r.status as "VALID"|"VOID",clockFlag:false}));
    const simulated=simulateWork([...sourceRecords,...scoped.days.flatMap(d=>d.records).filter(r=>r.source!=="API")],sharedChanges,scoped.id);
    for(const day of days){const check=sequenceProblems(workDayRecords(simulated.records,day.day),day.schedule);preview.warnings.push(...[...check.errors,...check.warnings].map(w=>`${period.code} / ${day.day}: ${w}`));}
   }
  }
  const impacts=periodEvidence.map(p=>p.id);prepared.push({id:plan.id,draft,version:draft.version,preview,sourceRequest,impacts,periodEvidence});
 }
 // Related employees share one durable source transaction and one request ID.
 const groups:number[][]=[];
 for(let i=0;i<prepared.length;i++){
  const ids=(prepared[i].sourceRequest?.employeeIds??people.find(p=>p.id===prepared[i].draft.employeeId)?.sourceIds??[]) as string[];
  const overlapping=groups.filter(g=>g.some(j=>((prepared[j].sourceRequest?.employeeIds??people.find(p=>p.id===prepared[j].draft.employeeId)?.sourceIds??[]) as string[]).some(id=>ids.includes(id))));
  if(!overlapping.length)groups.push([i]);else{const combined=[i,...overlapping.flat()];for(const group of overlapping)groups.splice(groups.indexOf(group),1);groups.push(combined);}
 }
 for(const group of groups.filter(g=>g.length>1&&g.some(i=>prepared[i].sourceRequest))){
  const requests=group.map(i=>prepared[i].sourceRequest!).filter(Boolean),changes=requests.flatMap(r=>r.changes as Record<string,unknown>[]);
  const employeeIds=[...new Set(requests.flatMap(r=>r.employeeIds as string[]))].sort(),from=requests.map(r=>String(r.from)).sort()[0],through=requests.map(r=>String(r.through)).sort().at(-1)!;
  const seen=new Set<string>();for(const c of changes){if(seen.has(String(c.eventId)))fail("Two employee plans change the same capture. Resolve the conflict before approving the batch.");seen.add(String(c.eventId));}
  const reviewDays=[...new Set(requests.flatMap(r=>r.reviewDays as string[]))].sort();
  const context={contextToken:"",records:[...new Map(requests.flatMap(r=>(r._context as SourceContext["records"])).map(r=>[r.eventId,r])).values()]};
  const request={...requests[0],id:prepared[group[0]].id,operation:changes.length?"apply-plan":"verify-context",employeeIds,from,through,reviewDays,contextToken:context.contextToken,_context:context.records,_localEvidence:Object.assign({},...requests.map(r=>r._localEvidence)),changes,reason:wireText(requests.map(r=>String(r.reason)).join("; "),1200),evidence:wireText(group.flatMap(i=>prepared[i].draft.changes.map(c=>c.evidence)).join("; "),2000)};
  for(const i of group)prepared[i].sourceRequest=request;
 }
 return {batchId,revision,prepared,digest:resolutionDigest([batchId,revision,prepared])};
}
export async function approveWorkBatch(actor:string,periodId:string,batchId:string,revision:number,acknowledgedDigest:string,database:typeof db=db,fetcher:typeof fetch=fetch,selectedPlanIds?:string[]) {
 if(process.env.ATTENDANCE_WORKBENCH_APPROVALS_ENABLED==="false")fail("New attendance approvals are paused. Existing delivery progress and history remain available; retry unfinished deliveries before changing release versions.");
 const prepared=await prepareWorkApproval(periodId,batchId,revision,database,fetcher,selectedPlanIds);if(acknowledgedDigest!==prepared.digest)fail("The final preview changed. Review all selected plans and acknowledge it again.");
 await database.transaction(async tx=>{await lockAttendancePayrollInput(tx);const [batch]=await tx.select().from(workBatches).where(eq(workBatches.id,batchId)).for("update");if(!batch||batch.state!=="Draft"||batch.revision!==revision)fail("Another administrator changed this batch.");
  const people=await workEmployees(periodId,tx);
  for(const plan of prepared.prepared){const person=people.find(p=>p.id===plan.draft.employeeId);if(!person||draftVersion(person,plan.draft.days)!==plan.version)fail("Attendance evidence changed during approval. Nothing was approved.");
   const conflicting=await tx.select().from(workPlans).where(and(eq(workPlans.employeeId,person.id),inArray(workPlans.state,activeStates)));
   if(conflicting.some(p=>p.batchId!==batchId&&p.id!==plan.draft.replaces&&(p.draft as WorkDraft).days.some(d=>plan.draft.days.includes(d))))fail("Another unfinished plan affects this employee and date.");
   if(plan.draft.replaces){const [old]=await tx.select().from(workPlans).where(eq(workPlans.id,plan.draft.replaces)).for("update");if(!old||old.employeeId!==plan.draft.employeeId||old.periodId!==periodId||!["Needs fresh review","Failed"].includes(old.state)||old.leaseUntil&&old.leaseUntil>new Date())fail("The previous delivery changed. Reopen its progress before approving this replacement.");await tx.update(workPlans).set({state:"Superseded",result:`Continued in reviewed plan ${plan.id}; prior delivery evidence retained`,updatedAt:new Date()}).where(eq(workPlans.id,old.id));await history(tx,actor,old.id,"Continued after fresh review",{replacement:plan.id});}
   await tx.update(workPlans).set({state:"Approved",sourceRequest:plan.sourceRequest,impactedPeriodIds:plan.impacts,updatedAt:new Date()}).where(eq(workPlans.id,plan.id));
   for(const evidence of plan.periodEvidence){
    const scoped=(evidence.id===periodId?people:await workEmployees(evidence.id,tx)).find(p=>p.id===person.id);
    const days=scoped?.days.filter(d=>evidence.days.some(old=>old.day===d.day));
    if(!scoped||resolutionDigest([scoped.mappingEvidence,days])!==evidence.version)fail("Evidence in an affected payroll period changed. Review the whole batch again.");
    const [period]=await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id,evidence.id));const runs=await tx.select().from(payrollRuns).where(eq(payrollRuns.payrollPeriodId,evidence.id));
    const posted=period.status!=="Open"||runs.some(r=>r.status==="Posted"&&r.inputSnapshot?.payrollGroup!=="Monthly");if(posted!==evidence.posted)fail("An affected payroll period changed status. Review the adjustment warning again.");
    if(posted)await tx.insert(adjustmentCases).values({planId:plan.id,periodId:evidence.id,employeeId:person.id,beforeEvidence:{runs:runs.filter(r=>r.status==="Posted"),days,draft:plan.draft}});
    else {
     const sourceRecords=draftRecords(scoped,plan.draft).filter(r=>plan.preview.records.some(p=>p.id===r.id)||plan.draft.days.includes(workDate(r.at)));
     const reviewDates=[...new Set([...plan.draft.days,...plan.preview.records.map(r=>workDate(r.at))])].filter(day=>scoped.days.some(d=>d.day===day));
     const records=[...new Map(reviewDates.flatMap(day=>workDayRecords(plan.preview.records,day)).filter(r=>r.employeeId===person.id).map(r=>[r.id,r])).values()];
     const affectedDays=[...new Set([...plan.draft.days,...sourceRecords.map(r=>workDate(r.at)),...records.map(r=>workDate(r.at))])].filter(day=>scoped.days.some(d=>d.day===day));
     if(affectedDays.length)await persistAdminDecision(tx,{periodId:evidence.id,planId:plan.id,actor,employeeNo:person.no,draft:{...plan.draft,days:affectedDays},sourceRecords:[...new Map(sourceRecords.map(r=>[r.id,r])).values()],records,warnings:plan.preview.warnings});
     await invalidateResolutionPeriod(tx,evidence.id,actor);
    }
   }
   await history(tx,actor,plan.id,"Approved",{digest:prepared.digest,warnings:plan.preview.warnings});
  }
  const remaining=await tx.select().from(workPlans).where(eq(workPlans.batchId,batchId));
  await tx.update(workBatches).set({state:remaining.some(p=>["Needs evidence","Ready for approval","Rejected","Needs fresh review"].includes(p.state))?"Draft":"Approved",revision:revision+1,acknowledgedDigest:prepared.digest,updatedAt:new Date()}).where(eq(workBatches.id,batchId));
 });
 return batchId;
}

export function impactSummary(person:WorkEmployee,draft:WorkDraft) {
 const proposed=previewWork(person,draft).records;
 return draft.days.map(day=>{const d=person.days.find(d=>d.day===day)!;const calculate=(records:WorkRecord[])=>summarizeEmployeeDay(day,records.filter(r=>r.status==="VALID"&&!r.excluded).map((r,i)=>{const wall=manilaWallTime(r.at);return {employeeNo:person.no,employeeId:person.id,loggedAt:new Date(wall.timestamp.replace(" ","T")+"Z"),logDate:wall.date,logTime:wall.time,direction:r.type,sourceLine:i,rawText:"Attendance review evidence"};}),d.schedule??{checkInTime:null,checkOutTime:null},d.leave);return {day,before:calculate(d.records),proposed:calculate(workDayRecords(proposed,day))};});
}
