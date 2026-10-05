import "server-only";
import { and, eq, inArray, sql, asc } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { attendanceRawLogs, attendanceImportBatches, payrollPeriods, payrollRuns } from "@/db/schema";
import { workPlans, workTreatments, workHistory, workRawLogs, workExclusions, workSourceExclusions, adjustmentCases, workBatches } from "@/db/attendanceWorkbenchSchema";
import { attendanceSourcePeriods } from "@/db/attendanceSourceSchema";
import { workbenchEnabled, workEmployees, draftVersion, workSource, impactSummary } from "./attendanceWorkbench";
import { type WorkDraft, type WorkDay, localToInstant, sequenceProblems, workDate } from "./attendanceWorkbenchModel";
import { manilaWallTime, type SourcePunch } from "./attendanceSourceClient";
import { lockAttendancePayrollInput } from "./attendanceSourceGuard";
import { PayrollValidationError } from "./validation";
import { resolutionDigest } from "./attendanceResolution";

function fail(message:string):never {throw new PayrollValidationError(message);}
const pending=["Approved","Applying","Sync pending","Failed","Needs fresh review"];
export async function assertWorkbenchReady(periodId:string,database:DbClient=db) {
 const unfinished=await database.select({id:workPlans.id}).from(workPlans).where(and(inArray(workPlans.state,pending),sql`(${workPlans.periodId}=${periodId}::uuid or ${workPlans.impactedPeriodIds} @> jsonb_build_array(${periodId}::text))`)).limit(1);
 if(unfinished.length)fail("Attendance corrections are unfinished. Open batch progress and retry or review changed evidence. Payroll was not recomputed.");
 const people=await workEmployees(periodId,database);if(people.some(p=>p.days.some(d=>d.issues.length)))fail("Attendance coverage needs review. Resolve the remaining employee workdays, missing schedules and identity matches before refreshing DTR or computing payroll.");
}

/** Called inside the reconciler's locked transaction, after a complete source pull. */
export async function reconcileWorkbenchInputs(tx:DbClient,periodId:string,records:SourcePunch[],runId:string) {
 if(!workbenchEnabled())return {touched:new Set<string>(),accepted:new Set<string>(),excluded:new Set<string>()};
 const touched=new Set<string>();
 const [period]=await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id,periodId));
 const payroll=await tx.select().from(payrollRuns).where(eq(payrollRuns.payrollPeriodId,periodId));
 const protectedPeriod=period.status!=="Open"||payroll.some(r=>r.status==="Posted");
 const candidates=await tx.select().from(workPlans).where(and(eq(workPlans.state,"Sync pending"),sql`(${workPlans.periodId}=${periodId}::uuid or ${workPlans.impactedPeriodIds} @> jsonb_build_array(${periodId}::text))`));
 for(const plan of candidates) {
  const draft=plan.draft as WorkDraft;
  const request=plan.sourceRequest as {operation:string;employeeIds:string[];from:string;through:string;reviewDays?:string[];_context:{eventId:string;type:string;capturedAt:string;employeeId:string;status:string}[];changes:{eventId:string;type?:string;capturedAt?:string;employeeId?:string;status?:string}[]}|null;
  const result=plan.sourceResult as {changes?:{event_id:string;after_json:string;revision:string}[]}|null;
  if(request&&(!result?.changes||request.changes.some(c=>!result.changes!.some(r=>r.event_id===c.eventId))))continue;
  if(request) {
   const expected=request._context.map(r=>{const changed=result!.changes!.find(c=>c.event_id===r.eventId);return changed?{...r,...JSON.parse(changed.after_json)}:r;});
   const observed=records.filter(r=>request.employeeIds.includes(r.employeeId)&&workDate(r.capturedAt)>=request.from&&workDate(r.capturedAt)<=request.through&&(!request.reviewDays||request.reviewDays.some(day=>Math.abs(Date.parse(workDate(r.capturedAt))-Date.parse(day))<=86400000)));
   const inPeriod=(r:{capturedAt:string})=>workDate(r.capturedAt)>=period.startDate&&workDate(r.capturedAt)<=period.endDate;
   const stale=expected.filter(inPeriod).some(e=>!observed.some(p=>p.eventId===e.eventId&&p.type===e.type&&p.capturedAt===e.capturedAt&&p.employeeId===e.employeeId&&p.status===e.status))||observed.filter(inPeriod).some(o=>!expected.some(e=>e.eventId===o.eventId))||result!.changes!.some(change=>{const p=records.find(r=>r.eventId===change.event_id);if(!p)return false;const after=JSON.parse(change.after_json);return p.type!==after.type||p.capturedAt!==after.capturedAt||p.employeeId!==after.employeeId||p.status!==after.status||p.effectiveRevision!==change.revision;});
   if(stale){await tx.update(workPlans).set({state:"Needs fresh review",result:"A source correction was applied, then relevant evidence changed. Review the preserved draft and delivery result before proceeding.",updatedAt:new Date()}).where(eq(workPlans.id,plan.id));continue;}
  }
  const people=await workEmployees(periodId,tx,records),person=people.find(p=>p.id===plan.employeeId);if(!person)continue;
  const local=(plan.sourceRequest as {_localEvidence?:Record<string,string>}|null)?._localEvidence?.[person.id];
  if(periodId===plan.periodId&&local&&local!==resolutionDigest([person.mappingEvidence,person.days.filter(d=>draft.days.includes(d.day)).map(d=>[d.day,d.configuration,d.leaveEvidence])])){await tx.update(workPlans).set({state:"Needs fresh review",result:"The schedule, leave or identity mapping changed after approval. Review the saved evidence before continuing.",updatedAt:new Date()}).where(eq(workPlans.id,plan.id));continue;}
  const changedDates=[...draft.days,...(result?.changes??[]).flatMap(c=>{const before=JSON.parse((c as {before_json?:string}).before_json??"null"),after=JSON.parse(c.after_json);return [before,after].filter(p=>p&&person.sourceIds.includes(p.employeeId)).map(p=>workDate(p.capturedAt));})];
  const changedDays=[...new Set(changedDates)].filter(d=>person.days.some(day=>day.day===d));
  if(protectedPeriod) {
   const [adjustment]=await tx.select().from(adjustmentCases).where(and(eq(adjustmentCases.planId,plan.id),eq(adjustmentCases.periodId,periodId)));
   const before=(adjustment?.beforeEvidence as {days?:WorkDay[]})?.days??[];
   const original=impactSummary({...person,days:before},{...draft,changes:[],days:changedDays.filter(d=>before.some(day=>day.day===d))});
   const calculated=impactSummary(person,{...draft,changes:draft.changes.filter(c=>!c.eventId||["Exclude","Retain"].includes(c.kind)),days:changedDays});
   const impact=calculated.map(row=>({...row,before:original.find(r=>r.day===row.day)?.before??row.before}));
   await tx.update(adjustmentCases).set({afterEvidence:person.days.filter(d=>changedDays.includes(d.day)),impact,updatedAt:new Date()}).where(and(eq(adjustmentCases.planId,plan.id),eq(adjustmentCases.periodId,periodId)));
   continue;
  }
  let batchId:string|undefined;
  const batch=async()=>{if(batchId)return batchId;const name=`attendance-api:${periodId}`;const [found]=await tx.select().from(attendanceImportBatches).where(and(eq(attendanceImportBatches.payrollPeriodId,periodId),eq(attendanceImportBatches.sourceFileName,name),eq(attendanceImportBatches.sourceFormat,"API")));if(found)batchId=found.id;else {const [created]=await tx.insert(attendanceImportBatches).values({payrollPeriodId:periodId,sourceFileName:name,sourceFormat:"API",status:"Processed",notes:"Managed source attendance and verified manual evidence"}).returning();batchId=created.id;}return batchId!;};
  for(const change of draft.changes.filter(c=>changedDays.includes(c.day))) {
   if(change.kind==="ReopenDay") {
    await tx.update(workTreatments).set({active:false}).where(and(eq(workTreatments.periodId,periodId),eq(workTreatments.employeeId,person.id),eq(workTreatments.day,change.day)));touched.add(person.id);
   }
   if((change.kind==="Exclude"||change.kind==="Retain")&&change.eventId) {
    if(!person.days.flatMap(d=>d.records).some(r=>r.id===change.eventId))fail("The selected source entry changed scope.");
    const version=resolutionDigest(records.find(p=>p.eventId===change.eventId));
    await tx.insert(workSourceExclusions).values({periodId,eventId:change.eventId,planId:plan.id,reason:change.reason||draft.reason,version,active:change.kind==="Exclude"}).onConflictDoUpdate({target:[workSourceExclusions.periodId,workSourceExclusions.eventId],set:{planId:plan.id,reason:change.reason||draft.reason,version,active:change.kind==="Exclude"}});touched.add(person.id);
   }
   if(change.kind==="Manual") {
    const at=localToInstant(change.at??"");if(!at||!change.type)fail("Stored manual evidence is incomplete.");
    const [existing]=await tx.select().from(workRawLogs).where(and(eq(workRawLogs.planId,plan.id),eq(workRawLogs.changeId,change.id)));if(existing)continue;
    const wall=manilaWallTime(at);const [inserted]=await tx.insert(attendanceRawLogs).values({batchId:await batch(),employeeId:person.id,employeeNo:person.no,direction:change.type,loggedAt:sql`${wall.timestamp}::timestamp`,logDate:wall.date,logTime:wall.time,rawText:JSON.stringify({source:"MANUAL_DTR",planId:plan.id,changeId:change.id,reason:change.reason||draft.reason,evidence:change.evidence}),normalizedHash:resolutionDigest(["workbench",plan.id,change.id])}).returning({id:attendanceRawLogs.id});
    await tx.insert(workRawLogs).values({planId:plan.id,changeId:change.id,rawLogId:inserted.id});touched.add(person.id);
   }
   if((change.kind==="Exclude"||change.kind==="Retain")&&change.rawLogId!==undefined) {
    const [target]=await tx.select().from(attendanceRawLogs).innerJoin(attendanceImportBatches,eq(attendanceImportBatches.id,attendanceRawLogs.batchId)).where(eq(attendanceRawLogs.id,change.rawLogId));
    if(!target||target.attendance_raw_logs.employeeId!==person.id||target.attendance_import_batches.payrollPeriodId!==periodId)fail("The competing record no longer belongs to this employee and period.");
    await tx.insert(workExclusions).values({rawLogId:change.rawLogId,planId:plan.id,reason:change.reason||draft.reason,active:change.kind==="Exclude"}).onConflictDoUpdate({target:workExclusions.rawLogId,set:{planId:plan.id,reason:change.reason||draft.reason,active:change.kind==="Exclude"}});touched.add(person.id);
   }
  }
  const after=(await workEmployees(periodId,tx,records)).find(p=>p.id===person.id)!;
  for(const day of changedDays){const d=after.days.find(d=>d.day===day)!;const check=sequenceProblems(d.records,d.schedule);
   if(draft.changes.some(c=>c.day===day&&c.kind==="ReopenDay"))continue;
   if(!d.records.some(r=>r.status==="VALID"&&!r.excluded)&&!draft.changes.some(c=>c.day===day&&c.kind==="NoAttendance"))continue;
   // Partial source repairs stay visible. Only a fully verified effective sequence is accepted.
   if(check.errors.length)continue;
   if(!draft.changes.some(c=>c.day===day&&["Manual","ConfirmSequence","NoAttendance","Exclude","Retain"].includes(c.kind)))continue;
   if(!d.schedule?.checkInTime||!d.schedule.checkOutTime||!after.sourceIds.length)continue;
   await tx.update(workTreatments).set({active:false}).where(and(eq(workTreatments.periodId,periodId),eq(workTreatments.employeeId,person.id),eq(workTreatments.day,day)));
   await tx.insert(workTreatments).values({planId:plan.id,periodId,employeeId:person.id,day,version:d.version,payload:{reason:draft.reason,evidence:draft.changes.filter(c=>c.day===day),kind:draft.changes.some(c=>c.day===day&&c.kind==="NoAttendance")?"NoAttendance":"Sequence"}});touched.add(person.id);
  }
 }
 const people=await workEmployees(periodId,tx,records),accepted=new Set<string>();
 for(const person of people)for(const day of person.days.filter(d=>d.resolved))accepted.add(`${person.id}|${day.day}`);
 if(touched.size)await tx.insert(attendanceSourcePeriods).values({payrollPeriodId:periodId,inputRunId:runId}).onConflictDoUpdate({target:attendanceSourcePeriods.payrollPeriodId,set:{inputRunId:runId,summariesRunId:null}});
 const excluded=new Set((await tx.select().from(workSourceExclusions).where(and(eq(workSourceExclusions.periodId,periodId),eq(workSourceExclusions.active,true)))).filter(x=>x.version===resolutionDigest(records.find(p=>p.eventId===x.eventId))).map(x=>x.eventId));
 return {touched,accepted,excluded};
}

/** Bounded outbox processing. A lost response is recovered by the durable source ID. */
export async function processWorkDelivery(actor:string,options:{batchId?:string;database?:typeof db;fetcher?:typeof fetch;sync?:(id:string,actor:string)=>Promise<unknown>;budgetMs?:number}={}) {
 if(!workbenchEnabled())return {completed:0,remaining:0};
 const database=options.database??db,deadline=Date.now()+(options.budgetMs??35000);
 const plans=await database.select().from(workPlans).where(and(inArray(workPlans.state,["Approved","Applying","Failed","Sync pending"]),options.batchId?eq(workPlans.batchId,options.batchId):undefined)).orderBy(asc(workPlans.updatedAt)).limit(20);
 const pendingPeriods=new Set<string>();let completed=0;
 for(const plan of plans) {
  if(Date.now()>deadline-9000)break;
  if(plan.leaseUntil&&plan.leaseUntil.getTime()>Date.now())continue;
  const claimed=await database.transaction(async tx=>{await lockAttendancePayrollInput(tx);const [p]=await tx.select().from(workPlans).where(eq(workPlans.id,plan.id)).for("update");if(!p||!["Approved","Applying","Failed","Sync pending"].includes(p.state)||p.leaseUntil&&p.leaseUntil.getTime()>Date.now())return null;const [saved]=await tx.update(workPlans).set({state:p.state==="Sync pending"?p.state:"Applying",leaseUntil:new Date(Date.now()+60000),attempts:p.attempts+1,updatedAt:new Date()}).where(eq(workPlans.id,p.id)).returning();return saved;});
  if(!claimed)continue;
  try {
   if(claimed.sourceRequest&&!claimed.sourceResult){
    const request=claimed.sourceRequest as Record<string,unknown>;
    if(request.operation==="verify-context") {
     const context=await workSource({operation:"context",version:1,employeeIds:request.employeeIds,from:request.from,through:request.through,reviewDays:request.reviewDays},options.fetcher);
     if(context.contextToken!==request.contextToken)fail("Source evidence changed. Review changed evidence before applying this plan.");
     await database.update(workPlans).set({sourceResult:{state:"Verified",changes:[]}}).where(eq(workPlans.id,claimed.id));
    } else {
    let status=await workSource({operation:"plan-status",version:1,id:request.id},options.fetcher);
    if(status.state!=="Applied") {const {_context,_localEvidence,...wire}=request;void _context;void _localEvidence;await workSource(wire,options.fetcher);status=await workSource({operation:"plan-status",version:1,id:request.id},options.fetcher);}
    if(status.state!=="Applied")fail("The source has not confirmed this plan yet.");
    await database.update(workPlans).set({sourceResult:status}).where(eq(workPlans.id,claimed.id));
    }
   }
   await database.update(workPlans).set({state:"Sync pending",result:"Correction delivery confirmed. Reconciliation is pending; payroll has not been recomputed.",leaseUntil:null,updatedAt:new Date()}).where(eq(workPlans.id,claimed.id));
   (claimed.impactedPeriodIds as string[]).filter(id=>!((claimed.sourceResult as {syncedPeriodIds?:string[]}|null)?.syncedPeriodIds??[]).includes(id)).forEach(id=>pendingPeriods.add(id));
  }catch(error){const message=error instanceof PayrollValidationError?error.message:"Delivery confirmation was interrupted. Retry unfinished work; the source may already have applied this plan.";await database.update(workPlans).set({state:message.includes("Source evidence changed")?"Needs fresh review":"Failed",leaseUntil:null,result:message,updatedAt:new Date()}).where(eq(workPlans.id,claimed.id));await database.insert(workHistory).values({planId:claimed.id,actor,action:"Delivery interrupted",details:{message}});}
 }
 const synced=new Set<string>();
 for(const period of pendingPeriods){if(Date.now()>deadline-9000)break;try{const sync=options.sync??(await import("./attendanceSourceSync")).syncAttendanceSourcePeriod;await sync(period,actor);synced.add(period);}catch(error){const message=error instanceof PayrollValidationError?error.message:"Period reconciliation was interrupted. Retry unfinished work; delivered corrections remain recorded.";for(const plan of plans.filter(p=>(p.impactedPeriodIds as string[]).includes(period)))await database.update(workPlans).set({result:message,updatedAt:new Date()}).where(and(eq(workPlans.id,plan.id),eq(workPlans.state,"Sync pending")));}}
 for(const plan of plans){const [current]=await database.select().from(workPlans).where(eq(workPlans.id,plan.id));if(current.state!=="Sync pending")continue;
  const result=(current.sourceResult??{}) as Record<string,unknown>;
  const already=(result.syncedPeriodIds??[]) as string[];
  const confirmed=[...new Set([...already,...synced])].filter(id=>(current.impactedPeriodIds as string[]).includes(id));
  await database.update(workPlans).set({sourceResult:{...result,syncedPeriodIds:confirmed}}).where(eq(workPlans.id,plan.id));
  const remaining=(current.impactedPeriodIds as string[]).filter(id=>!confirmed.includes(id));
  if(remaining.length)continue;
  await database.update(workPlans).set({state:"Resolved",result:"Delivered and synced. Inspect remaining cases and DTR. Payroll has not been recomputed.",updatedAt:new Date()}).where(eq(workPlans.id,plan.id));await database.insert(workHistory).values({planId:plan.id,actor,action:"Reconciled",details:{periodIds:current.impactedPeriodIds}});completed++;
 }
 return {completed,remaining:plans.length-completed};
}
export async function closeAdjustment(tx:DbClient,actor:string,id:string,reference:string,conclusion:string,confirmed:boolean) {
 if(!confirmed||conclusion.trim().length<10)fail("Review the impact and record evidence for the adjustment or no-impact conclusion.");await lockAttendancePayrollInput(tx);
 const [item]=await tx.select().from(adjustmentCases).where(eq(adjustmentCases.id,id)).for("update");if(!item||item.state!=="Open"||!item.afterEvidence||!item.impact)fail("Sync the confirmed correction and review its impact before closing this case.");
 const [plan]=await tx.select().from(workPlans).where(eq(workPlans.id,item.planId));if(plan.state!=="Resolved")fail("Finish the correction and sync before closing its adjustment case.");
 if(!reference.trim()&&JSON.stringify(item.impact).length<10)fail("Supply an adjustment reference or verified no-impact evidence.");
 await tx.update(adjustmentCases).set({state:reference.trim()?"Adjustment recorded":"No impact approved",adjustmentReference:reference.trim()||null,conclusion,closedBy:actor,updatedAt:new Date()}).where(eq(adjustmentCases.id,id));await tx.insert(workHistory).values({planId:item.planId,actor,action:"Adjustment case closed",details:{id,reference,conclusion}});
}
export async function reopenWorkPlan(tx:DbClient,actor:string,id:string) {
 await lockAttendancePayrollInput(tx);const [plan]=await tx.select().from(workPlans).where(eq(workPlans.id,id)).for("update");if(!plan||!["Needs fresh review","Rejected","Needs evidence","Ready for approval"].includes(plan.state))fail("Only unfinished review drafts can be reopened here.");
 const [batch]=await tx.select().from(workBatches).where(eq(workBatches.id,plan.batchId));
 const person=(await workEmployees(plan.periodId,tx)).find(p=>p.id===plan.employeeId);if(!person)fail("Employee no longer eligible.");
 const draft=plan.draft as WorkDraft;await tx.insert(workHistory).values({planId:id,actor,action:"Evidence review reopened",details:{previous:draft,current:person.days.filter(d=>draft.days.includes(d.day))}});
 let applied=plan.sourceResult as {state?:string;changes?:{event_id:string}[]}|null;
 if(batch.state!=="Draft"&&!applied&&plan.sourceRequest){const request=plan.sourceRequest as {operation:string;id:string};if(request.operation==="apply-plan")applied=await workSource({operation:"plan-status",version:1,id:request.id});}
 const savedManual=await tx.select().from(workRawLogs).where(eq(workRawLogs.planId,plan.id));
 const changes=draft.changes.map(c=>applied?.changes?.some(p=>p.event_id===c.eventId)||savedManual.some(m=>m.changeId===c.id)?{...c,id:crypto.randomUUID(),kind:"ConfirmSequence" as const,eventId:undefined,rawLogId:undefined,at:undefined,type:undefined,verified:false}:{...c,verified:false});
 return {draft:{...draft,version:draftVersion(person,draft.days),rejected:false,changes,...(batch.state!=="Draft"?{replaces:plan.id}:{})},existing:batch.state==="Draft"?{id:batch.id,revision:batch.revision}:undefined};
}
export async function undoWorkDraft(database:DbClient,actor:string,id:string) {
 const [plan]=await database.select().from(workPlans).where(eq(workPlans.id,id));if(!plan||plan.state!=="Resolved")fail("Finish reconciliation before preparing Undo.");
 const people=await workEmployees(plan.periodId,database),person=people.find(p=>p.id===plan.employeeId);if(!person)fail("Employee no longer eligible; review the identity first.");
 const old=plan.draft as WorkDraft,result=plan.sourceResult as {changes?:{event_id:string;before_json:string;after_json:string;revision:string}[]}|null;
 const requestId=(plan.sourceRequest as {id?:string}|null)?.id;
 const related=requestId?(await database.select().from(workPlans).where(eq(workPlans.batchId,plan.batchId))).filter(p=>(p.sourceRequest as {id?:string}|null)?.id===requestId):[plan];
 if(related.some(p=>p.state!=="Resolved"))fail("Finish every related employee plan before preparing Undo.");
 const later=await database.select().from(workPlans).where(inArray(workPlans.state,["Approved","Applying","Sync pending","Failed","Needs fresh review","Resolved"]));
 for(const prior of related)if(later.some(p=>!related.some(r=>r.id===p.id)&&p.employeeId===prior.employeeId&&p.updatedAt>prior.updatedAt&&(p.draft as WorkDraft).days.some(d=>(prior.draft as WorkDraft).days.includes(d))))fail("Later attendance decisions depend on this plan. Review their history before making a new correction.");
 const changes:WorkDraft["changes"]=[];
 for(const item of result?.changes??[]) {
  const before=JSON.parse(item.before_json),record=people.flatMap(p=>p.contextRecords??p.days.flatMap(d=>d.records)).find(r=>r.id===item.event_id);
  if(!record||record.sourcePunch?.effectiveRevision!==item.revision)fail("A later source correction prevents Undo. Review its history before making a new correction.");
  const target=people.find(p=>p.sourceIds.includes(before.employeeId));if(!target)fail("Verify the original employee identity before Undo.");
  changes.push({id:crypto.randomUUID(),day:old.days.includes(workDate(before.capturedAt))?workDate(before.capturedAt):old.days[0],kind:"UndoCapture",employeeId:record.employeeId,eventId:item.event_id,type:before.type,at:manilaWallTime(before.capturedAt).timestamp.replace(" ","T"),targetEmployeeId:target.id,status:before.status,clockVerified:before.clockVerified,reason:"Undo prior correction",evidence:"",verified:false});
 }
 for(const prior of related){
  const owner=people.find(p=>p.id===prior.employeeId);if(!owner)fail("A related employee is no longer eligible. Review the employee record before Undo.");
  const add=(c:WorkDraft["changes"][number])=>changes.push({...c,employeeId:owner.id});
  const manual=await database.select().from(workRawLogs).where(eq(workRawLogs.planId,prior.id));
  for(const r of manual){const record=owner.days.flatMap(d=>d.records).find(p=>p.rawLogId===r.rawLogId);if(!record)fail("A later attendance change removed manual evidence. Review history before Undo.");add({id:crypto.randomUUID(),day:workDate(record.at),kind:"Exclude",rawLogId:r.rawLogId,reason:"Undo verified manual entry",evidence:"",verified:false});}
  const exclusions=await database.select().from(workExclusions).where(eq(workExclusions.planId,prior.id));
  for(const r of exclusions){const record=owner.days.flatMap(d=>d.records).find(p=>p.rawLogId===r.rawLogId);if(!record)fail("Competing attendance evidence changed. Review history before Undo.");add({id:crypto.randomUUID(),day:workDate(record.at),kind:r.active?"Retain":"Exclude",rawLogId:r.rawLogId,reason:"Undo source selection",evidence:"",verified:false});}
  const sourceExclusions=await database.select().from(workSourceExclusions).where(and(eq(workSourceExclusions.planId,prior.id),eq(workSourceExclusions.periodId,plan.periodId)));
  for(const r of sourceExclusions){const record=owner.days.flatMap(d=>d.records).find(p=>p.id===r.eventId);if(!record||r.version!==resolutionDigest(record.sourcePunch))fail("Source selection evidence changed. Review history before Undo.");add({id:crypto.randomUUID(),day:workDate(record.at),kind:r.active?"Retain":"Exclude",eventId:r.eventId,reason:"Undo source selection",evidence:"",verified:false});}
  for(const day of (prior.draft as WorkDraft).days)add({id:crypto.randomUUID(),day,kind:"ReopenDay",reason:"Undo prior attendance treatment",evidence:"",verified:false});
 }
 const ownerIds=[...new Set(changes.flatMap(c=>[c.employeeId??person.id,...(c.kind==="UndoCapture"&&c.targetEmployeeId?[c.targetEmployeeId]:[])]))];
 return ownerIds.map(owner=>{const target=people.find(p=>p.id===owner)!;const own=changes.filter(c=>(c.employeeId??person.id)===owner);for(const c of changes.filter(c=>c.kind==="UndoCapture"&&c.targetEmployeeId===owner&&c.employeeId!==owner))if(!own.some(x=>x.day===c.day))own.push({id:crypto.randomUUID(),day:c.day,kind:"ReopenDay",reason:"Review the other employee affected by Undo",evidence:"",verified:false});const days=[...new Set(own.map(c=>c.day))].sort();return {employeeId:owner,days,changes:own,ownerId:actor,reason:"Undo prior attendance resolution",needed:"Verify the reversal and downstream DTR impact",rejected:false,version:draftVersion(target,days),...(result?.changes?.length?{undoOf:(plan.sourceRequest as {id:string}).id}:{})} satisfies WorkDraft;});
}
