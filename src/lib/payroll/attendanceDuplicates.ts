import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { payrollPeriods, adminAuditEvents } from "@/db/schema";
import { attendanceDuplicatePolicy as policies, attendanceDuplicateChecks as checks, attendanceResolutions as resolutions } from "@/db/attendanceSourceSchema";
import { duplicateCandidates, DUPLICATE_RULE_VERSION, type DuplicateBoard, type DuplicatePolicy, type DuplicateMode } from "./attendanceDuplicateModel";
import { resolutionPeople, proposeAttendanceResolution, reviewAttendanceResolution, applySourceResolution, invalidateResolutionPeriod, type SourceCorrectionRequest } from "./attendanceResolution";
import { lockAttendancePayrollInput } from "./attendanceSourceGuard";
import { sourceDayOffset, manilaWallTime, type SourcePunch } from "./attendanceSourceClient";
import { duplicateImpactSafe } from "./attendanceDuplicateImpact";
import { PayrollValidationError } from "./validation";

type Metadata={kept:SourcePunch;removed:SourcePunch[];automatic:boolean;ruleVersion:string;groupId:string;impactedPeriodIds:string[];undoOf?:string};
function fail(message:string):never { throw new PayrollValidationError(message); }
async function policy(database:DbClient):Promise<DuplicatePolicy> {
 const [row]=await database.select().from(policies).where(eq(policies.id,"global"));
 return {mode:(row?.mode??"Suggest") as DuplicateMode,revision:row?.revision??"unconfigured",enabledAfter:row?.enabledAfter?.toISOString()??null};
}
export async function loadDuplicateBoard(periodId:string,database:DbClient=db):Promise<DuplicateBoard> {
 const [period]=await database.select().from(payrollPeriods).where(eq(payrollPeriods.id,periodId));if(!period)fail("Select a payroll period.");
 const settings=await policy(database),people=await resolutionPeople(database,{id:period.id,startDate:period.startDate,endDate:period.endDate});
 const history=await database.select().from(resolutions).where(and(eq(resolutions.payrollPeriodId,periodId),sql`${resolutions.duplicateMetadata} IS NOT NULL`)).orderBy(desc(resolutions.createdAt)).limit(100);
 const candidates=settings.mode==="Off"?[]:people.flatMap(p=>duplicateCandidates(p.records,period.startDate,period.endDate,settings,{verified:!!p.employeeId&&p.classification!=="TestOnly",conflictingDecision:!!p.resolution,version:p.version}));
 const outcomes=await database.select().from(checks).where(eq(checks.payrollPeriodId,periodId));
 for(const c of candidates){const check=outcomes.find(r=>r.keptEventId===c.id&&r.sourceVersion===c.version&&r.policyRevision===settings.revision);if(check)c.warnings.push(`Last automatic check: ${check.result}`);}
 return {policy:settings,candidates,history:history.map(r=>{const m=r.duplicateMetadata as Metadata;return {id:r.id,state:r.state,automatic:m.automatic,ruleVersion:m.ruleVersion,actor:r.reviewerUserId??r.actorUserId,groupId:m.groupId,restored:!!m.undoOf,reason:r.reason,kept:m.kept,removed:m.removed,createdAt:r.createdAt.toISOString(),result:r.result,canUndo:r.state==="Applied"&&!m.undoOf&&!history.some(h=>(h.duplicateMetadata as Metadata).undoOf===r.id&&h.state!=="Rejected")};})};
}
export async function setDuplicatePolicy(tx:DbClient,actor:string,mode:DuplicateMode,revision:string,confirmed:boolean) {
 if(!["Off","Suggest","Automatic"].includes(mode)||!confirmed)fail("Review and confirm the duplicate policy before saving.");
 await lockAttendancePayrollInput(tx);const before=await policy(tx);if(before.revision!==revision)fail("The policy changed. Refresh and review again.");
 const after={mode,revision:randomUUID(),enabledAfter:mode==="Automatic"?before.mode==="Automatic"&&before.enabledAfter?new Date(before.enabledAfter):new Date():null,actorUserId:actor,updatedAt:new Date()};
 await tx.insert(policies).values({id:"global",...after}).onConflictDoUpdate({target:policies.id,set:after});
 await tx.insert(adminAuditEvents).values({actorUserId:actor,entityType:"attendance_duplicate_policy",entityId:"global",action:"attendance.duplicate_policy",details:JSON.stringify({before,after})});
}
async function sourceContext(person:string,from:string,through:string,fetcher:typeof fetch) {
 const origin=new URL(process.env.ATTENDANCE_SOURCE_ORIGIN??"");if(origin.protocol!=="https:"||origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)fail("Invalid attendance connection.");
 const r=await fetcher(new URL("/v1/integra/corrections",origin),{method:"POST",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000),headers:{"Content-Type":"application/json",Authorization:`Bearer ${process.env.ATTENDANCE_CORRECTION_TOKEN??""}`},body:JSON.stringify({operation:"duplicateContext",employeeId:person,from,through})});
 if(!r.ok)fail("The source duplicate check is unavailable. Sync and retry; no correction was approved.");
 const value=await r.json();if(!/^[0-9a-f]{64}$/.test(value.contextToken)||typeof value.settled!=="boolean"||!Array.isArray(value.records))fail("The source duplicate response could not be verified.");
 return value as {contextToken:string;settled:boolean;coverageThrough:number;records:{id:string;type:string;at:string;action:string;device:string;branch:string;version:string;updatedAt:string;clock:number;excluded:number;reviewFlags:string[];reviewResolved:boolean}[]};
}

/** Preflight the whole selected batch, then commit all outbox approvals in one transaction. */
export async function approveDuplicateBatch(periodId:string,selection:{id:string;version:string}[],reason:string,confirmed:boolean,actor:string,automatic=false,database=db,fetcher:typeof fetch=fetch) {
 if(!confirmed||typeof reason!=="string"||reason.trim().length<3||reason.length>400||!Array.isArray(selection)||!selection.length||selection.length>20||new Set(selection.map(s=>s.id)).size!==selection.length)fail("Select up to 20 duplicate groups and confirm the verification reason.");
 const initial=await loadDuplicateBoard(periodId,database),[period]=await database.select().from(payrollPeriods).where(eq(payrollPeriods.id,periodId));
 if(!period)fail("Select a payroll period.");
 const chosen=selection.map(s=>{const c=initial.candidates.find(c=>c.id===s.id&&c.version===s.version);if(!c)fail("The selection changed. Refresh and review again.");return c;});
 if(new Set(chosen.map(c=>c.sourceId)).size!==chosen.length)fail("Approve one group per employee, sync, then review the next group.");
 const from=sourceDayOffset(period.startDate,-1),through=sourceDayOffset(period.endDate,1);
 const contexts:Awaited<ReturnType<typeof sourceContext>>[]=[];for(const c of chosen)contexts.push(await sourceContext(c.sourceId,from,through,fetcher));
 const ids=await database.transaction(async transaction=>{
  const tx=transaction as DbClient;await lockAttendancePayrollInput(tx);
  const current=await loadDuplicateBoard(periodId,tx),people=await resolutionPeople(tx,{id:period.id,startDate:period.startDate,endDate:period.endDate});
  if(current.policy.revision!==initial.policy.revision||current.policy.mode==="Off"||automatic&&current.policy.mode!=="Automatic")fail("The duplicate policy changed. Review the current setting.");
  const result:string[]=[];
  for(const [index,old]of chosen.entries()) {
   const c=current.candidates.find(c=>c.id===old.id&&c.version===old.version);if(!c)fail("Attendance or the employee match changed. Sync and review again.");
   const context=contexts[index],person=people.find(p=>p.sourceId===c.sourceId)!;
   if(!person.employeeId||person.classification==="TestOnly"||person.resolution)fail("Review the employee match or existing attendance decision first.");
   // The displayed neighbors and payroll comparison must describe the same full
   // employee window the source will commit against, not only the selected pair.
   if(context.records.length!==person.records.length)fail("Source evidence changed. Sync and review again.");
   for(const p of person.records){const r=context.records.find(r=>r.id===p.eventId);if(!r||r.type!==p.type||r.at!==p.capturedAt||(r.action==="VOID")!==(p.status==="VOID")||r.device!==p.deviceId||r.branch!==p.branchId||r.version!==p.correctionVersion||r.updatedAt!==p.updatedAt||!!r.clock!==p.clockFlag||!!r.excluded!==!!p.duplicateExcluded||r.reviewResolved!==p.reviewResolved||JSON.stringify([...(r.reviewFlags??[])].sort())!==JSON.stringify([...p.reviewFlags].sort()))fail("Source evidence changed. Sync and review again.");}
   if(automatic) {
    if(!c.eligible||!context.settled||context.coverageThrough<Date.parse(c.removed.at(-1)!.capturedAt)+600000)fail("Uploads or duplicate evidence still require review.");
    if(!await duplicateImpactSafe(tx,periodId,person.employeeId,person.employeeNo!,person.records,c,period.startDate,period.endDate))fail("The schedule or payroll effect needs individual review.");
   }
   // Adjacent periods may use this employee's surrounding sequence even before import.
   const neighbors=person.records.filter(p=>p.status==="VALID"&&p.capturedAt>c.removed.at(-1)!.capturedAt).sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt));
   const impactFrom=manilaWallTime(c.kept.capturedAt).date,impactThrough=manilaWallTime(neighbors[0]?.capturedAt??c.removed.at(-1)!.capturedAt).date;
   const affected=await tx.select().from(payrollPeriods).where(and(lte(payrollPeriods.startDate,impactThrough),gte(payrollPeriods.endDate,impactFrom)));
   for(const p of affected.sort((a,b)=>a.id.localeCompare(b.id)))await invalidateResolutionPeriod(tx,p.id,actor);
   const id=await proposeAttendanceResolution(tx,actor,{periodId,sourceId:c.sourceId,version:c.version,kind:"SourceVoid",reason:reason.trim(),evidence:`${DUPLICATE_RULE_VERSION}; keep ${c.kept.eventId}; ${c.gapSeconds}s anchored window`,confirmed:true,manualPunches:[],eventIds:c.removed.map(r=>r.eventId)},true);
   const [created]=await tx.select().from(resolutions).where(eq(resolutions.id,id));
   const request=(created.sourceRequests as SourceCorrectionRequest[])[0];
   const extended={...request,duplicate:{keptEventId:c.kept.eventId,eventIds:c.removed.map(r=>r.eventId),ruleVersion:DUPLICATE_RULE_VERSION,automatic,enabledAfter:current.policy.enabledAfter,contextToken:context.contextToken,from,through}};
   await tx.update(resolutions).set({sourceRequests:[extended],duplicateMetadata:{kept:c.kept,removed:c.removed,automatic,ruleVersion:DUPLICATE_RULE_VERSION,groupId:request.id,impactedPeriodIds:affected.map(p=>p.id)} satisfies Metadata}).where(eq(resolutions.id,id));
   await reviewAttendanceResolution(tx,actor,id,"Approve",reason.trim());result.push(id);
  }return result;
 });
 const messages=[];for(const id of ids)messages.push(await applySourceResolution(id,actor,true,database,fetcher));
 return {ids,message:messages.join(" ")};
}

export async function undoDuplicate(id:string,reason:string,actor:string,database=db,fetcher:typeof fetch=fetch) {
 const undo=await database.transaction(async transaction=>{
  const tx=transaction as DbClient;await lockAttendancePayrollInput(tx);
  const [row]=await tx.select().from(resolutions).where(eq(resolutions.id,id));const meta=row?.duplicateMetadata as Metadata|null;
  if(!row||row.state!=="Applied"||!meta||meta.undoOf)fail("This group is not available for undo. Check delivery history.");
  if((await tx.select({id:resolutions.id}).from(resolutions).where(sql`${resolutions.duplicateMetadata}->>'undoOf'=${id} AND ${resolutions.state}<>'Rejected'`)).length)fail("Undo was already requested. Check its history.");
  const [period]=await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id,row.payrollPeriodId));
  const person=(await resolutionPeople(tx,{id:period.id,startDate:period.startDate,endDate:period.endDate})).find(p=>p.sourceId===row.sourceEmployeeId);if(!person)fail("Sync the period first.");
  if(!meta.removed.every(p=>person.records.some(r=>r.eventId===p.eventId&&r.status==="VOID"&&r.duplicateGroupId===meta.groupId)))fail("Sync first. A selected record may have a newer correction; it must be reviewed individually.");
  for(const periodId of [...meta.impactedPeriodIds].sort())await invalidateResolutionPeriod(tx,periodId,actor);
  const next=await proposeAttendanceResolution(tx,actor,{periodId:period.id,sourceId:person.sourceId,version:person.version,kind:"SourceRestore",reason,evidence:`Undo duplicate group ${id}; preserve an automatic-handling exception`,confirmed:true,manualPunches:[],eventIds:meta.removed.map(p=>p.eventId)},true);
  await tx.update(resolutions).set({duplicateMetadata:{...meta,automatic:false,undoOf:id}}).where(eq(resolutions.id,next));
  await reviewAttendanceResolution(tx,actor,next,"Approve",reason);return next;
 });
 return applySourceResolution(undo,actor,true,database,fetcher);
}

export async function processAutomaticDuplicates(periodId:string,actor:string,database=db,fetcher:typeof fetch=fetch) {
 const board=await loadDuplicateBoard(periodId,database);if(board.policy.mode!=="Automatic")return 0;
 const attempts=await database.select().from(checks).where(eq(checks.payrollPeriodId,periodId));
 const checkedAt=(c:typeof board.candidates[number])=>attempts.find(a=>a.keptEventId===c.id&&a.sourceVersion===c.version&&a.policyRevision===board.policy.revision)?.checkedAt.getTime()??0;
 let handled=0;const deadline=Date.now()+20000;
 // Rotate unsuccessful checks so a review-only employee cannot starve later groups.
 for(const c of board.candidates.filter(c=>c.eligible).sort((a,b)=>checkedAt(a)-checkedAt(b)).slice(0,3)) {
  if(Date.now()>deadline)break;
  try {const result=await approveDuplicateBatch(periodId,[{id:c.id,version:c.version}],"Automatic duplicate policy: retain the first verified capture",true,actor,true,database,fetcher);const [row]=await database.select().from(resolutions).where(eq(resolutions.id,result.ids[0]));if(row.state==="Applied")handled++;}
  catch(error){const note=error instanceof PayrollValidationError?error.message:"Automatic checks could not finish. Review the records or retry sync.";await database.insert(checks).values({payrollPeriodId:periodId,keptEventId:c.id,sourceVersion:c.version,policyRevision:board.policy.revision,result:note}).onConflictDoUpdate({target:[checks.payrollPeriodId,checks.keptEventId],set:{sourceVersion:c.version,policyRevision:board.policy.revision,result:note,checkedAt:new Date()}});}
 }return handled;
}
