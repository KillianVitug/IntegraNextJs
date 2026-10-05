import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, desc, gte, lte, isNull, inArray } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { employees, employeesGeneralInfo, employeesTimekeeping, employeeShiftAssignments, employeeWeeklyShiftPatterns, employeeWeeklyShiftPatternDays, employeesLeaveRecords, employeeLeaveRecordDays, payrollPeriods, payrollRuns, attendanceRawLogs, attendanceImportBatches, authAccounts } from "@/db/schema";
import { attendanceSourceMappings as mappings, attendanceSourceEvents as events, attendanceSourceProjections as projections, attendanceSourceIdentities as identities } from "@/db/attendanceSourceSchema";
import { workBatches, workPlans, workTreatments, workHistory, adjustmentCases, workRawLogs, workExclusions, workSourceExclusions } from "@/db/attendanceWorkbenchSchema";
import { resolutionDigest, loadAttendanceReadiness, invalidateResolutionPeriod } from "./attendanceResolution";
import { resolveEmployeeScheduleForDate, isResolvedScheduleRestDay } from "./scheduleResolver";
import { manilaWallTime, sourceDayOffset, type SourcePunch } from "./attendanceSourceClient";
import { type WorkBoard, type WorkDraft, type WorkRecord, type WorkEmployee, type WorkDay, simulateWork, sequenceProblems, suggestionsForDay, dayStatus, workDate, localToInstant } from "./attendanceWorkbenchModel";
import { lockAttendancePayrollInput } from "./attendanceSourceGuard";
import { PayrollValidationError } from "./validation";
import { attendanceSchedulerActorAuthorized } from "./attendanceSourceActor";
import { summarizeEmployeeDay } from "./attendance";

export const workbenchEnabled=()=>process.env.ATTENDANCE_WORKBENCH_ENABLED==="true";
function fail(message:string):never {throw new PayrollValidationError(message);}
const wireText=(value:string,limit:number)=>value.replace(/\s+/g," ").trim().slice(0,limit);
function enabled(){if(!workbenchEnabled())fail("The new attendance workflow is not activated.");}
const idPattern=/^[0-9a-f-]{36}$/i;
const activeStates=["Approved","Applying","Sync pending","Failed","Needs fresh review"];
export function workDayRecords(records:WorkRecord[],day:string) {
 const all=records.slice().sort((a,b)=>a.at.localeCompare(b.at)), own=all.filter(r=>workDate(r.at)===day);
 const first=own.find(r=>r.status==="VALID"&&!r.excluded),last=own.filter(r=>r.status==="VALID"&&!r.excluded).at(-1);
 if(first?.type==="OUT") {const prev=all.filter(r=>r.at<first.at&&r.status==="VALID"&&!r.excluded).at(-1);if(prev?.type==="IN"&&Date.parse(first.at)-Date.parse(prev.at)<=86400000)own.unshift(prev);}
 if(last?.type==="IN") {const next=all.find(r=>r.at>last.at&&r.status==="VALID"&&!r.excluded);if(next?.type==="OUT"&&Date.parse(next.at)-Date.parse(last.at)<=86400000)own.push(next);}
 return own;
}
export async function workEmployees(periodId:string,database:DbClient=db,incoming?:SourcePunch[],now=new Date().toISOString()):Promise<WorkEmployee[]> {
 const [period]=await database.select().from(payrollPeriods).where(eq(payrollPeriods.id,periodId));if(!period)fail("Payroll period not found.");
 const [roster,links,identity,source,raw,timekeeping,assignments,patterns,patternDays,leaves,leaveDays,treatments,excluded,manualLinks,sourceExcluded]=await Promise.all([
  database.select({person:employees,info:employeesGeneralInfo}).from(employees).leftJoin(employeesGeneralInfo,eq(employeesGeneralInfo.employeeId,employees.id)).where(and(isNull(employees.deletedAt),eq(employees.employeeType,"EMP"))),
  database.select().from(mappings),database.select().from(identities),incoming?Promise.resolve(incoming):database.select({payload:events.payload}).from(projections).innerJoin(events,eq(events.eventId,projections.eventId)).where(eq(projections.payrollPeriodId,periodId)).then(r=>r.map(x=>x.payload as SourcePunch)),
  database.select({log:attendanceRawLogs,format:attendanceImportBatches.sourceFormat}).from(attendanceRawLogs).innerJoin(attendanceImportBatches,eq(attendanceImportBatches.id,attendanceRawLogs.batchId)).where(eq(attendanceImportBatches.payrollPeriodId,periodId)),
  database.select().from(employeesTimekeeping),database.select().from(employeeShiftAssignments),database.select().from(employeeWeeklyShiftPatterns),database.select().from(employeeWeeklyShiftPatternDays),
  database.select().from(employeesLeaveRecords).where(and(eq(employeesLeaveRecords.leaveStatus,"Approved"),isNull(employeesLeaveRecords.deletedAt))),database.select().from(employeeLeaveRecordDays),database.select().from(workTreatments).where(and(eq(workTreatments.periodId,periodId),eq(workTreatments.active,true))),database.select().from(workExclusions).where(eq(workExclusions.active,true)),database.select().from(workRawLogs),database.select().from(workSourceExclusions).where(and(eq(workSourceExclusions.periodId,periodId),eq(workSourceExclusions.active,true))),
 ]);
 return roster.filter(({info})=>!info?.dateHired||info.dateHired<=period.endDate).filter(({info})=>!info?.separationDate||info.separationDate>=period.startDate).filter(({info})=>!info||!["Resigned","Terminated","Finished Conctract"].includes(info.employmentStatus??"")||!!info.separationDate).map(({person,info})=>{
  const employeeLinks=links.filter(m=>m.employeeId===person.id&&!identity.some(i=>i.sourceEmployeeId===m.sourceEmployeeId&&i.classification==="TestOnly")),sourceIds=employeeLinks.map(m=>m.sourceEmployeeId);
  const records:WorkRecord[]=source.filter(p=>sourceIds.includes(p.employeeId)).map(p=>({id:p.eventId,source:"API",employeeId:person.id,type:p.type,at:p.capturedAt,status:p.status,clockFlag:p.clockFlag,clockVerified:p.clockVerified,originalType:p.originalType??p.type,originalAt:p.originalCapturedAt??p.capturedAt,sourceEmployeeId:p.employeeId,sourcePunch:p,excluded:sourceExcluded.some(x=>x.eventId===p.eventId&&x.version===resolutionDigest(p))}));
  for(const {log,format} of raw.filter(r=>r.log.employeeId===person.id)) {
   const managed=manualLinks.find(x=>x.rawLogId===log.id);
   if(format==="API"&&!managed&&!log.rawText?.includes('"MANUAL_DTR"'))continue;
   records.push({id:`raw:${log.id}`,rawLogId:log.id,source:managed||format==="API"?"Manual":"File",employeeId:person.id,type:log.direction,at:new Date(`${log.logDate}T${log.logTime}+08:00`).toISOString(),status:"VALID",clockFlag:false,excluded:excluded.some(x=>x.rawLogId===log.id)});
  }
  const days:WorkDay[]=[];
  for(let day=period.startDate;day<=period.endDate;day=sourceDayOffset(day,1)) {
   if(info?.dateHired&&day<info.dateHired||info?.separationDate&&day>info.separationDate)continue;
   const resolved=resolveEmployeeScheduleForDate({attendanceDate:day,assignments:assignments.filter(a=>a.employeeId===person.id),weeklyPatterns:patterns.filter(p=>p.employeeId===person.id).map(p=>({...p,days:patternDays.filter(d=>d.patternId===p.id)})),legacyTimekeeping:timekeeping.find(t=>t.employeeId===person.id)??null});
   const schedule=resolved.source==="LEGACY"&&!timekeeping.some(t=>t.employeeId===person.id)?null:resolved.shiftWindow;
   const dayLeaves=leaves.filter(l=>l.employeeId===person.id&&l.leaveStartDate&&l.leaveStartDate<=day&&l.leaveEndDate&&l.leaveEndDate>=day);
   const leave=dayLeaves.reduce((n,l)=>{const detail=leaveDays.find(d=>d.leaveRecordId===l.id&&d.leaveDate===day);return n+(detail?Number(detail.quantity):0)*(schedule?.hoursPerDay??0)*60;},0);
   const own=workDayRecords(records,day),context=records.filter(r=>workDate(r.at)>=sourceDayOffset(day,-1)&&workDate(r.at)<=sourceDayOffset(day,1));
   const configuration={schedule,source:resolved.source,assignment:resolved.overrideAssignment,pattern:resolved.weeklyPatternDay,employment:info?{hired:info.dateHired,separated:info.separationDate,status:info.employmentStatus}:null};
   const leaveEvidence=dayLeaves.map(l=>({record:l,detail:leaveDays.filter(d=>d.leaveRecordId===l.id&&d.leaveDate===day)}));
   const version=resolutionDigest([configuration,leaveEvidence,employeeLinks,identity.filter(i=>sourceIds.includes(i.sourceEmployeeId)),context]);
   const treatment=treatments.find(t=>t.employeeId===person.id&&t.day===day&&t.version===version);
   const status=dayStatus({day,schedule,rest:isResolvedScheduleRestDay(resolved),leave,records:own,now});
   const issues=status==="Future"||status==="In progress / awaiting upload"||status==="Rest day"||status==="Approved leave"?[]:sequenceProblems(own,schedule).errors;
   for(const record of own.filter(r=>r.source==="API"&&!r.excluded&&r.status==="VALID"&&!r.sourcePunch?.reviewResolved))if(record.sourcePunch?.reviewFlags.length)issues.push("Review source warnings: "+record.sourcePunch.reviewFlags.join(", "));
   if(status==="Missing workday")issues.push("Verify missing workday or confirm no attendance");
   if(status==="Schedule missing")issues.push("Configure the employee schedule");
   if(!sourceIds.length)issues.push("Verify an attendance employee mapping");
   if(own.some(r=>r.source==="API")&&own.some(r=>r.source==="File"&&!r.excluded))issues.push("Choose between overlapping API and file punches");
   if(own.some(r=>r.source==="API")&&own.some(r=>r.source==="Manual"&&!r.excluded))issues.push("Compare original and manual evidence; prevent duplicate time");
   if(dayLeaves.some(l=>!leaveDays.some(d=>d.leaveRecordId===l.id&&d.leaveDate===day)))issues.push("Review missing leave day details in Leave");
   if(treatment&&!issues.includes("Configure the employee schedule")&&!issues.includes("Verify an attendance employee mapping"))issues.length=0;
   days.push({day,schedule,rest:isResolvedScheduleRestDay(resolved),leave,leaveEvidence,configuration,records:own,status,issues:[...new Set(issues)],suggestions:suggestionsForDay(day,own,schedule),version,resolved:!!treatment});
  }
  return {id:person.id,no:person.employeeNo,name:[person.firstName,person.middleName,person.lastName].filter(Boolean).join(" "),sourceIds,mappingEvidence:employeeLinks,hired:info?.dateHired??null,separated:info?.separationDate??null,days,contextRecords:records};
 }).sort((a,b)=>a.no.localeCompare(b.no));
}
export function draftVersion(employee:WorkEmployee,days:string[]) {return [...new Set(days)].sort().map(day=>`${day}:${employee.days.find(d=>d.day===day)?.version??"missing"}`).join("|");}
export function previewWork(employee:WorkEmployee,draft:WorkDraft,sharedRecords?:WorkRecord[],sharedChanges?:WorkDraft["changes"]) {
 const context=sharedRecords??Array.from(new Map([...draft.days.flatMap(day=>employee.days.find(d=>d.day===day)?.records??[]),...(employee.contextRecords??[]).filter(r=>draft.changes.some(c=>c.eventId===r.id))].map(r=>[r.id,r])).values());
 const simulated=simulateWork(context,sharedChanges??draft.changes,employee.id),errors=[...simulated.errors],warnings:string[]=[];
 for(const c of draft.changes) {
  if(!["Direction","Time","Employee","Void","Restore","Manual","ConfirmSequence","NoAttendance","Exclude","Retain","UndoCapture","ReopenDay"].includes(c.kind))errors.push("Unknown correction type");
  if(c.eventId||c.rawLogId!==undefined){const selected=context.find(r=>c.eventId?r.id===c.eventId:r.rawLogId===c.rawLogId);if(!selected||selected.employeeId!==employee.id)errors.push("A selected capture belongs to another employee. Review it in that employee's plan.");if(selected?.source!=="API"&&["Direction","Time","Employee","Void","Restore","UndoCapture"].includes(c.kind))errors.push("File/manual entries require an explicit source selection and verified replacement.");}
  if(!draft.days.includes(c.day)||!employee.days.some(d=>d.day===c.day))errors.push("A change falls outside the reviewed workdays");
  if(!c.verified||c.evidence.trim().length<3||(c.reason.trim()||draft.reason.trim()).length<3)errors.push("Verify each selected change and supply its evidence and reason");
  if(c.at&&!localToInstant(c.at))errors.push("Invalid verified capture time");
  if(c.at&&localToInstant(c.at)&&Date.parse(localToInstant(c.at)!)>Date.now()+300000)errors.push("Verified work cannot be in the future");
  if(c.kind==="Manual"&&c.at&&(c.at.slice(0,10)<sourceDayOffset(draft.days.slice().sort()[0],-1)||c.at.slice(0,10)>sourceDayOffset(draft.days.slice().sort().at(-1)!,1)))errors.push("Manual attendance is outside the reviewed shift context");
  if(c.kind==="Employee")warnings.push("Employee reassignment also affects the receiving employee; both must be included in batch review");
 }
 for(const day of draft.days) {
  const original=employee.days.find(d=>d.day===day);if(!original){errors.push("Workday is outside employee eligibility");continue;}
  const list=workDayRecords(simulated.records,day),check=sequenceProblems(list,original.schedule);
  if(draft.changes.some(c=>c.day===day&&c.kind==="ConfirmSequence")&&!list.some(r=>r.status==="VALID"&&!r.excluded))errors.push("There is no sequence to confirm. Add verified times or explicitly confirm no attendance.");
  if(draft.changes.some(c=>c.day===day&&["Manual","ConfirmSequence","NoAttendance"].includes(c.kind))) {
   errors.push(...check.errors);
   if(!employee.sourceIds.length)errors.push("Verify the employee mapping first");
   if(!original.schedule?.checkInTime||!original.schedule.checkOutTime)errors.push("Configure a verified schedule first");
   if(draft.changes.some(c=>c.day===day&&c.kind==="NoAttendance")&&list.some(r=>r.status==="VALID"&&!r.excluded))errors.push("No-attendance confirmation requires no effective punches");
  }
  warnings.push(...check.warnings,...check.errors.map(e=>`Remaining: ${e}`));
 }
 return {...simulated,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
}
export async function loadWorkBoard(periodId:string,database:DbClient=db):Promise<WorkBoard> {
 enabled();const [period]=await database.select().from(payrollPeriods).where(eq(payrollPeriods.id,periodId));if(!period)fail("Select a payroll period.");
 const [people,plans,adjustments,batches,readiness,accounts]=await Promise.all([workEmployees(periodId,database),database.select().from(workPlans).where(eq(workPlans.periodId,periodId)).orderBy(desc(workPlans.updatedAt)).limit(200),database.select().from(adjustmentCases).where(eq(adjustmentCases.periodId,periodId)),database.select().from(workBatches).where(eq(workBatches.periodId,periodId)),loadAttendanceReadiness(periodId,database),database.select({id:authAccounts.id,name:employees.firstName}).from(authAccounts).innerJoin(employees,eq(authAccounts.employeeId,employees.id)).where(eq(authAccounts.status,"Active"))]);
 const owners=[];for(const a of accounts)if(await attendanceSchedulerActorAuthorized(database,a.id))owners.push(a);
 const auditHistory=await database.select({id:workHistory.id,planId:workHistory.planId,action:workHistory.action,actor:workHistory.actor,at:workHistory.createdAt}).from(workHistory).innerJoin(workPlans,eq(workPlans.id,workHistory.planId)).where(eq(workPlans.periodId,periodId)).orderBy(desc(workHistory.createdAt)).limit(300);
 for(const plan of plans.filter(p=>p.state==="Rejected")){const draft=plan.draft as WorkDraft,person=people.find(p=>p.id===plan.employeeId);if(person&&draft.version===draftVersion(person,draft.days))for(const day of person.days.filter(d=>draft.days.includes(d.day)))day.suggestions=[];}
 return {period:{id:period.id,code:period.code,startDate:period.startDate,endDate:period.endDate,posted:!readiness.periodOpen},employees:people,plans:plans.map(p=>({id:p.id,batchId:p.batchId,revision:batches.find(b=>b.id===p.batchId)?.revision??0,state:p.state,draft:p.draft as WorkDraft,result:p.result,updatedAt:p.updatedAt.toISOString()})),history:auditHistory.map(h=>({...h,at:h.at.toISOString()})),adjustments:adjustments.map(a=>({id:a.id,employeeId:a.employeeId,periodId:a.periodId,state:a.state,impact:a.impact,reference:a.adjustmentReference,conclusion:a.conclusion})),owners,statuses:{sync:readiness.needsSync?"Sync required":"Up to date",review:people.some(e=>e.days.some(d=>d.issues.length))?"Needs review":"Ready",delivery:plans.some(p=>activeStates.includes(p.state))?"Unfinished work":"Up to date",dtr:readiness.summariesOutdated?"Refresh needed":"Up to date",payroll:readiness.periodOpen?"Recompute and review explicitly":"Posted / closed — adjustment required"},enabled:true};
}
async function history(database:DbClient,actor:string,planId:string|null,action:string,details:unknown){await database.insert(workHistory).values({actor,planId,action,details});}
export async function saveWorkDraft(database:DbClient,actor:string,periodId:string,drafts:WorkDraft[],existing?:{id:string;revision:number}) {
 enabled();if(!idPattern.test(periodId)||!Array.isArray(drafts)||!drafts.length||drafts.length>20||drafts.reduce((n,d)=>n+d.changes.length,0)>200||new Set(drafts.map(d=>d.employeeId)).size!==drafts.length)fail("Select 1–20 distinct employee plans and no more than 200 changes. Divide larger selections explicitly.");
 await lockAttendancePayrollInput(database);
 const people=await workEmployees(periodId,database);
 const sharedRecords=Array.from(new Map(drafts.flatMap(d=>{const p=people.find(p=>p.id===d.employeeId);return [...(p?.days.filter(day=>d.days.includes(day.day)).flatMap(day=>day.records)??[]),...(p?.contextRecords??[]).filter(r=>d.changes.some(c=>c.eventId===r.id))];}).map(r=>[r.id,r])).values());
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
  if(previous)await database.update(workPlans).set(values).where(eq(workPlans.id,planId));else await database.insert(workPlans).values({...values,id:planId,batchId:id,periodId,employeeId:draft.employeeId});
  await history(database,actor,planId,"Draft saved",draft);
 }
 for(const removed of old.filter(p=>!drafts.some(d=>d.employeeId===p.employeeId)))await database.update(workPlans).set({state:"Removed from draft",updatedAt:new Date()}).where(eq(workPlans.id,removed.id));
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
export async function prepareWorkApproval(periodId:string,batchId:string,revision:number,database:DbClient=db,fetcher:typeof fetch=fetch) {
 enabled();const [batch]=await database.select().from(workBatches).where(eq(workBatches.id,batchId));if(!batch||batch.periodId!==periodId||batch.revision!==revision||batch.state!=="Draft")fail("Reopen the current saved batch.");
 const people=await workEmployees(periodId,database),plans=(await database.select().from(workPlans).where(eq(workPlans.batchId,batchId))).filter(p=>p.state!=="Removed from draft");
 const sharedChanges=plans.flatMap(p=>(p.draft as WorkDraft).changes.map(c=>({...c,employeeId:p.employeeId})));
 const sharedRecords=Array.from(new Map(plans.flatMap(p=>{const e=people.find(e=>e.id===p.employeeId),draft=p.draft as WorkDraft;return [...(e?.days.filter(d=>draft.days.includes(d.day)).flatMap(d=>d.records)??[]),...(e?.contextRecords??[]).filter(r=>draft.changes.some(c=>c.eventId===r.id))];}).map(r=>[r.id,r])).values());
 if(!plans.length||plans.some(p=>p.state!=="Ready for approval"))fail("Every selected plan needs to be ready. No selected plans were skipped.");
 const prepared:{id:string;draft:WorkDraft;version:string;preview:ReturnType<typeof previewWork>;sourceRequest:Record<string,unknown>|null;impacts:string[];periodEvidence:{id:string;code:string;posted:boolean;days:WorkDay[];version:string}[]}[]=[];
 for(const plan of plans){const draft=plan.draft as WorkDraft,person=people.find(p=>p.id===plan.employeeId)!;
  if(!person||draft.version!==draftVersion(person,draft.days))fail("Relevant attendance, mapping or schedule evidence changed. Review the batch again.");
  const preview=previewWork(person,draft,sharedRecords,sharedChanges);if(preview.errors.length)fail(preview.errors.join(". "));
  const targets=draft.changes.filter(c=>c.kind==="Employee"||c.kind==="UndoCapture"&&c.targetEmployeeId&&c.targetEmployeeId!==person.id).map(c=>people.find(p=>p.id===c.targetEmployeeId));
  if(targets.some(t=>!t||t.sourceIds.length!==1||!plans.some(p=>p.employeeId===t.id)))fail("Employee reassignment requires a verified unique target identity and both employees in this batch.");
  const sourceChanges=draft.changes.filter(c=>c.eventId&&!["Exclude","Retain"].includes(c.kind));
  const affectedDates=[...new Set([...draft.days,...draft.changes.flatMap(c=>[...(c.at?[c.at.slice(0,10)]:[]),...(c.eventId?sharedRecords.filter(r=>r.id===c.eventId).map(r=>workDate(r.at)):[])])])].sort();
  let sourceRequest:Record<string,unknown>|null=null;
  if(person.sourceIds.length){
   const employeeIds=[...new Set([...person.sourceIds,...targets.flatMap(t=>t!.sourceIds)])],from=sourceDayOffset(affectedDates[0],-1),through=sourceDayOffset(affectedDates.at(-1)!,1);
   const context=await workSource({operation:"context",version:1,employeeIds,from,through,reviewDays:affectedDates},fetcher) as unknown as SourceContext;
   if(draft.changes.some(c=>["Manual","NoAttendance"].includes(c.kind))){
    const reviewedThrough=Math.max(...draft.days.map(day=>{const schedule=person.days.find(d=>d.day===day)?.schedule;const end=schedule?.checkOutTime??"23:59:59",endDay=schedule?.checkInTime&&end<=schedule.checkInTime?sourceDayOffset(day,1):day;return Date.parse(`${endDay}T${end}+08:00`)+30*60000;}));
    if(context.uploadCoverage?.state!=="Confirmed"||!context.uploadCoverage.through||Date.parse(context.uploadCoverage.through)<reviewedThrough)fail("Uploads still need verification for the reviewed workdays. Keep this draft, ask the branch to connect its attendance phone and complete uploads, then use Check uploads / Sync this period and review again. No manual attendance or no-attendance decision was approved.");
   }
   for(const c of sourceChanges){const observed=(person.contextRecords??person.days.flatMap(d=>d.records)).find(r=>r.id===c.eventId),live=context.records.find(r=>r.eventId===c.eventId);if(!observed||!live||live.type!==observed.type||live.capturedAt!==observed.at||live.status!==observed.status||live.employeeId!==observed.sourceEmployeeId)fail("The source capture changed. Sync and review again.");}
   const wireChanges=sourceChanges.map(c=>({eventId:c.eventId,...(c.kind==="Direction"||c.kind==="UndoCapture"?{type:c.type}:{}),...(c.kind==="Time"||c.kind==="UndoCapture"?{capturedAt:localToInstant(c.at!)}:{}),...(c.kind==="Employee"||c.kind==="UndoCapture"?{employeeId:people.find(t=>t.id===(c.targetEmployeeId??person.id))!.sourceIds[0]}:{}),...(c.kind==="Void"||c.kind==="Restore"?{status:c.kind==="Void"?"VOID":"VALID"}:{}),...(c.kind==="UndoCapture"?{status:c.status,clockVerified:c.clockVerified}: {})}));
   const combined=Array.from(wireChanges.reduce((map,c)=>map.set(c.eventId!,{...map.get(c.eventId!),...c}),new Map<string,typeof wireChanges[number]>()).values());
   sourceRequest={operation:sourceChanges.length?"apply-plan":"verify-context",version:1,id:plan.id,employeeIds,from,through,reviewDays:affectedDates,contextToken:context.contextToken,_context:context.records,actor:batch.actor,reason:wireText(draft.reason||draft.changes.map(c=>c.reason).join("; "),1200),evidence:wireText(draft.changes.map(c=>c.evidence).join("; "),2000),...(draft.undoOf?{undoOf:draft.undoOf}:{}),changes:combined};
  }
  const allPeriods=(await database.select().from(payrollPeriods).where(and(lte(payrollPeriods.startDate,sourceDayOffset(affectedDates.at(-1)!,1)),gte(payrollPeriods.endDate,sourceDayOffset(affectedDates[0],-1))))).filter(p=>affectedDates.some(day=>day>=sourceDayOffset(p.startDate,-1)&&day<=sourceDayOffset(p.endDate,1)));
  if(sourceRequest)sourceRequest._localEvidence={ [person.id]:resolutionDigest([person.mappingEvidence,person.days.filter(d=>draft.days.includes(d.day)).map(d=>[d.day,d.configuration,d.leaveEvidence])]) };
  for(const day of draft.changes.filter(c=>c.at).map(c=>c.at!.slice(0,10)))if(!allPeriods.some(p=>day>=p.startDate&&day<=p.endDate))fail(`Create the payroll period containing ${day} before approving a date change. Your draft is retained.`);
  const periodEvidence=[];
  for(const period of allPeriods){
   const scoped=(period.id===periodId?people:await workEmployees(period.id,database)).find(p=>p.id===person.id);
   if(!scoped)fail(`Employee is not eligible in affected period ${period.code}. Review employment dates before approval.`);
   for(const date of draft.changes.filter(c=>c.at).map(c=>c.at!.slice(0,10)))if(date>=period.startDate&&date<=period.endDate&&!scoped.days.some(d=>d.day===date))fail(`The corrected date ${date} is outside this employee's employment dates.`);
   const days=scoped.days.filter(d=>affectedDates.some(day=>Math.abs(Date.parse(d.day)-Date.parse(day))<=86400000));
   const runs=await database.select().from(payrollRuns).where(eq(payrollRuns.payrollPeriodId,period.id));
   const posted=period.status!=="Open"||runs.some(r=>r.status==="Posted");
   periodEvidence.push({id:period.id,code:period.code,posted,days,version:resolutionDigest([scoped.mappingEvidence,days])});
   if(posted)preview.warnings.push(`${period.code}: posted payroll remains unchanged; a linked adjustment case is required.`);
   if(period.id!==periodId){
    const sourceContext=(sourceRequest?._context??[]) as SourceContext["records"];
    const sourceRecords:WorkRecord[]=sourceContext.filter(r=>scoped.sourceIds.includes(r.employeeId)).map(r=>({id:r.eventId,source:"API",employeeId:scoped.id,type:r.type as "IN"|"OUT",at:r.capturedAt,status:r.status as "VALID"|"VOID",clockFlag:false}));
    const simulated=simulateWork([...sourceRecords,...scoped.days.flatMap(d=>d.records).filter(r=>r.source!=="API")],sharedChanges,scoped.id);
    for(const day of days){const check=sequenceProblems(workDayRecords(simulated.records,day.day),day.schedule);preview.warnings.push(...[...check.errors,...check.warnings].map(w=>`${period.code} / ${day.day}: ${w}`));}
   }
  }
  const impacts=allPeriods.map(p=>p.id);prepared.push({id:plan.id,draft,version:draft.version,preview,sourceRequest,impacts,periodEvidence});
 }
 // Related employees share one durable source transaction and one request ID.
 const groups:number[][]=[];
 for(let i=0;i<prepared.length;i++){
  const ids=(prepared[i].sourceRequest?.employeeIds??[]) as string[];
  const overlapping=groups.filter(g=>g.some(j=>((prepared[j].sourceRequest?.employeeIds??[]) as string[]).some(id=>ids.includes(id))));
  if(!overlapping.length)groups.push([i]);else{const combined=[i,...overlapping.flat()];for(const group of overlapping)groups.splice(groups.indexOf(group),1);groups.push(combined);}
 }
 for(const group of groups.filter(g=>g.length>1)){
  const requests=group.map(i=>prepared[i].sourceRequest!).filter(Boolean),changes=requests.flatMap(r=>r.changes as Record<string,unknown>[]);
  const employeeIds=[...new Set(requests.flatMap(r=>r.employeeIds as string[]))].sort(),from=requests.map(r=>String(r.from)).sort()[0],through=requests.map(r=>String(r.through)).sort().at(-1)!;
  const seen=new Set<string>();for(const c of changes){if(seen.has(String(c.eventId)))fail("Two employee plans change the same capture. Resolve the conflict before approving the batch.");seen.add(String(c.eventId));}
  const reviewDays=[...new Set(requests.flatMap(r=>r.reviewDays as string[]))].sort();
  const context=await workSource({operation:"context",version:1,employeeIds,from,through,reviewDays},fetcher) as unknown as SourceContext;
  const request={...requests[0],id:prepared[group[0]].id,operation:changes.length?"apply-plan":"verify-context",employeeIds,from,through,reviewDays,contextToken:context.contextToken,_context:context.records,_localEvidence:Object.assign({},...requests.map(r=>r._localEvidence)),changes,reason:wireText(requests.map(r=>String(r.reason)).join("; "),1200),evidence:wireText(group.flatMap(i=>prepared[i].draft.changes.map(c=>c.evidence)).join("; "),2000)};
  for(const i of group)prepared[i].sourceRequest=request;
 }
 return {batchId,revision,prepared,digest:resolutionDigest([batchId,revision,prepared])};
}
export async function approveWorkBatch(actor:string,periodId:string,batchId:string,revision:number,acknowledgedDigest:string,database:typeof db=db,fetcher:typeof fetch=fetch) {
 if(process.env.ATTENDANCE_WORKBENCH_APPROVALS_ENABLED==="false")fail("New attendance approvals are paused. Existing delivery progress and history remain available; retry unfinished deliveries before changing release versions.");
 const prepared=await prepareWorkApproval(periodId,batchId,revision,database,fetcher);if(acknowledgedDigest!==prepared.digest)fail("The final preview changed. Review all selected plans and acknowledge it again.");
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
    const posted=period.status!=="Open"||runs.some(r=>r.status==="Posted");if(posted!==evidence.posted)fail("An affected payroll period changed status. Review the adjustment warning again.");
    if(posted)await tx.insert(adjustmentCases).values({planId:plan.id,periodId:evidence.id,employeeId:person.id,beforeEvidence:{runs:runs.filter(r=>r.status==="Posted"),days,draft:plan.draft}});else await invalidateResolutionPeriod(tx,evidence.id,actor);
   }
   await history(tx,actor,plan.id,"Approved",{digest:prepared.digest,warnings:plan.preview.warnings});
  }
  await tx.update(workBatches).set({state:"Approved",acknowledgedDigest:prepared.digest,updatedAt:new Date()}).where(eq(workBatches.id,batchId));
 });
 return batchId;
}

export function impactSummary(person:WorkEmployee,draft:WorkDraft) {
 const proposed=previewWork(person,draft).records;
 return draft.days.map(day=>{const d=person.days.find(d=>d.day===day)!;const calculate=(records:WorkRecord[])=>summarizeEmployeeDay(day,records.filter(r=>r.status==="VALID"&&!r.excluded).map((r,i)=>{const wall=manilaWallTime(r.at);return {employeeNo:person.no,employeeId:person.id,loggedAt:new Date(wall.timestamp.replace(" ","T")+"Z"),logDate:wall.date,logTime:wall.time,direction:r.type,sourceLine:i,rawText:"Attendance review evidence"};}),d.schedule??{checkInTime:null,checkOutTime:null},d.leave);return {day,before:calculate(d.records),proposed:calculate(workDayRecords(proposed,day))};});
}
