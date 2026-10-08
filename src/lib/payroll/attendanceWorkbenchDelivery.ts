import "server-only";
import { and, eq, inArray, sql, asc } from "drizzle-orm";
import { db, type DbClient } from "@/db";

import { workPlans, workTreatments, workHistory, workRawLogs, workExclusions, workSourceExclusions, adjustmentCases, workBatches } from "@/db/attendanceWorkbenchSchema";

import { workbenchEnabled, workEmployees, draftVersion, workSource } from "./attendanceWorkbench";
import { type WorkDraft, workDate } from "./attendanceWorkbenchModel";
import { manilaWallTime, type SourcePunch } from "./attendanceSourceClient";
import { lockAttendancePayrollInput } from "./attendanceSourceGuard";
import { PayrollValidationError } from "./validation";
import { adminDecision } from "./attendanceAdminDecision";
import { resolutionDigest } from "./attendanceResolution";

function fail(message:string):never {throw new PayrollValidationError(message);}
export async function assertWorkbenchReady(periodId:string,database:DbClient=db) {
 // Readiness belongs to effective approved inputs, not source delivery or missing phone data.
 void periodId; void database;

}

/** Called inside the reconciler's locked transaction, after a complete source pull. */
export async function reconcileWorkbenchInputs(tx:DbClient,periodId:string,records:SourcePunch[],runId:string) {
 if(!workbenchEnabled())return {touched:new Set<string>(),accepted:new Set<string>(),excluded:new Set<string>()};
 const touched=new Set<string>();
 // Source pulls never replay retired outbox plans. Existing approved local decisions remain authoritative.
 void runId;
 const people=await workEmployees(periodId,tx,records),accepted=new Set<string>();
 for(const person of people)for(const day of person.days.filter(d=>d.resolved))accepted.add(`${person.id}|${day.day}`);

 const excluded=new Set((await tx.select().from(workSourceExclusions).where(and(eq(workSourceExclusions.periodId,periodId),eq(workSourceExclusions.active,true)))).filter(x=>x.version===resolutionDigest(records.find(p=>p.eventId===x.eventId))).map(x=>x.eventId));
 return {touched,accepted,excluded};
}

/** Retire the former source outbox using receipt reads only. Never replay a request. */
export async function processWorkDelivery(actor:string,options:{batchId?:string;database?:typeof db;fetcher?:typeof fetch;sync?:(id:string,actor:string)=>Promise<unknown>;budgetMs?:number}={}) {
 const database=options.database??db,deadline=Date.now()+(options.budgetMs??35000);
 const plans=await database.select().from(workPlans).where(and(inArray(workPlans.state,["Approved","Applying","Failed","Sync pending","Source conflict","Needs fresh review"]),sql`${workPlans.sourceResult}->'readOnlyCutover' is null`,sql`(${workPlans.sourceRequest} is not null or ${workPlans.state} in ('Approved','Applying','Failed','Sync pending'))`,options.batchId?eq(workPlans.batchId,options.batchId):undefined)).orderBy(asc(workPlans.updatedAt)).limit(20);
 let completed=0;
 for(const plan of plans) {
  if(Date.now()>deadline-9000)break;
  if(plan.leaseUntil&&plan.leaseUntil.getTime()>Date.now())continue;
  if(!plan.sourceRequest&&["Needs fresh review","Source conflict"].includes(plan.state))continue;
  const previous=(plan.sourceResult??{}) as Record<string,unknown>;
  if(previous.readOnlyCutover)continue;
  let receipt:Record<string,unknown>|null=null,receiptState="Not requested";
  const request=plan.sourceRequest as {operation?:string;id?:string}|null;
  if(request?.operation==="apply-plan"&&request.id){
   try{receipt=await workSource({operation:"plan-status",id:request.id},options.fetcher);receiptState=String(receipt.state);}
   catch{receiptState="Unverified";}
  }
  const retired=await database.transaction(async tx=>{
   await lockAttendancePayrollInput(tx);
   const [current]=await tx.select().from(workPlans).where(eq(workPlans.id,plan.id)).for("update");
   if(!current||current.updatedAt.getTime()!==plan.updatedAt.getTime()||(current.sourceResult as Record<string,unknown>|null)?.readOnlyCutover||current.leaseUntil&&current.leaseUntil.getTime()>Date.now())return false;
   const decisions=await tx.select().from(workTreatments).where(eq(workTreatments.planId,plan.id));
   const localApproved=decisions.some(t=>adminDecision(t.payload));
   const message=`Source delivery retired — ${receiptState==="Applied"?"historical application confirmed":receiptState==="Not found"?"no applied source receipt":receiptState==="Unverified"?"historical receipt unavailable; application remains unverified":"no source update requested"}. ${localApproved?"Approved local payroll attendance is retained.":"Saved evidence is retained; review a local payroll override if needed."} Phone attendance was not changed.`;
   await tx.update(workPlans).set({state:localApproved?"Resolved":"Needs fresh review",leaseUntil:null,sourceResult:{...previous,...(receipt?.state==="Applied"?receipt:{}),readOnlyCutover:{at:new Date().toISOString(),actor,receiptState,receipt,localApproved,previousResult:current.sourceResult}},result:message,updatedAt:new Date()}).where(eq(workPlans.id,plan.id));
   await tx.insert(workHistory).values({planId:plan.id,actor,action:"Source delivery retired",details:{previousState:current.state,sourceRequest:current.sourceRequest,previousResult:current.sourceResult,receiptState,receipt,localApproved,sourceMutationSent:false}});
   return true;
  });
  if(retired)completed++;
 }
 return {completed,remaining:plans.filter(p=>!(p.sourceResult as Record<string,unknown>|null)?.readOnlyCutover&&(p.sourceRequest||!["Needs fresh review","Source conflict"].includes(p.state))).length-completed};
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
 const people=await workEmployees(plan.periodId,tx);const person=people.find(p=>p.id===plan.employeeId);if(!person)fail("Employee no longer eligible.");
 const draft=plan.draft as WorkDraft;await tx.insert(workHistory).values({planId:id,actor,action:"Evidence review reopened",details:{previous:draft,current:person.days.filter(d=>draft.days.includes(d.day))}});
 let applied=plan.sourceResult as {state?:string;changes?:{event_id:string}[]}|null;
 if(batch.state!=="Draft"&&!applied&&plan.sourceRequest){const request=plan.sourceRequest as {operation:string;id:string};if(request.operation==="apply-plan")applied=await workSource({operation:"plan-status",version:1,id:request.id});}
 const savedManual=await tx.select().from(workRawLogs).where(eq(workRawLogs.planId,plan.id));
 const changes=draft.changes.map(c=>applied?.changes?.some(p=>p.event_id===c.eventId)||savedManual.some(m=>m.changeId===c.id)?{...c,id:crypto.randomUUID(),kind:"ConfirmSequence" as const,eventId:undefined,rawLogId:undefined,at:undefined,type:undefined,verified:false}:{...c,verified:false});
 const current={...draft,version:draftVersion(person,draft.days),rejected:false,changes,...(batch.state!=="Draft"?{replaces:plan.id}:{})};
 const siblings=batch.state==="Draft"?(await tx.select().from(workPlans).where(eq(workPlans.batchId,batch.id))).filter(p=>p.id!==plan.id&&["Ready for approval","Needs evidence","Rejected","Needs fresh review"].includes(p.state)).map(p=>{const saved=p.draft as WorkDraft,employee=people.find(e=>e.id===p.employeeId);return {...saved,version:employee?draftVersion(employee,saved.days):saved.version,changes:saved.changes.map(c=>({...c,verified:false}))};}):[];
 return {draft:current,drafts:[...siblings,current],existing:batch.state==="Draft"?{id:batch.id,revision:batch.revision}:undefined};
}
export async function undoWorkDraft(database:DbClient,actor:string,id:string) {
 const [plan]=await database.select().from(workPlans).where(eq(workPlans.id,id));if(!plan||plan.state!=="Resolved")fail("Finish reconciliation before preparing Undo.");
 const people=await workEmployees(plan.periodId,database),person=people.find(p=>p.id===plan.employeeId);if(!person)fail("Employee no longer eligible; review the identity first.");
 const old=plan.draft as WorkDraft,result=plan.sourceResult as {state?:string;changes?:{event_id:string;before_json:string;after_json:string;revision:string}[]}|null;
 const requestId=(plan.sourceRequest as {id?:string}|null)?.id;
 const batchPlans=await database.select().from(workPlans).where(eq(workPlans.batchId,plan.batchId));
 let related=requestId?batchPlans.filter(p=>(p.sourceRequest as {id?:string}|null)?.id===requestId):[plan];
 if(result?.state==="LocalOnly"){
  const employees=new Set([plan.employeeId]);let grew=true;
  while(grew){grew=false;for(const candidate of batchPlans){const draft=candidate.draft as WorkDraft,owners=[candidate.employeeId,...draft.changes.flatMap(c=>c.targetEmployeeId?[c.targetEmployeeId]:[])];if(owners.some(id=>employees.has(id)))for(const id of owners)if(!employees.has(id)){employees.add(id);grew=true;}}}
  related=batchPlans.filter(p=>employees.has(p.employeeId));
 }
 if(related.some(p=>p.state!=="Resolved"))fail("Finish every related employee plan before preparing Undo.");
 const later=await database.select().from(workPlans).where(inArray(workPlans.state,["Approved","Applying","Sync pending","Failed","Needs fresh review","Resolved"]));
 for(const prior of related)if(later.some(p=>!related.some(r=>r.id===p.id)&&p.employeeId===prior.employeeId&&p.updatedAt>prior.updatedAt&&(p.draft as WorkDraft).days.some(d=>(prior.draft as WorkDraft).days.includes(d))))fail("Later attendance decisions depend on this plan. Review their history before making a new correction.");
 const changes:WorkDraft["changes"]=[];
 if(result?.state==="LocalOnly"){
  const snapshots=await database.select().from(workTreatments).where(inArray(workTreatments.planId,related.map(p=>p.id)));
  const afterRecords=snapshots.flatMap(t=>adminDecision(t.payload)?.records??[]);
  const handled=new Set<string>();
  for(const snapshot of snapshots){const decision=adminDecision(snapshot.payload);if(!decision)continue;
   for(const before of decision.sourceRecords){
    const after=afterRecords.find(r=>r.id===before.id);if(!after||handled.has(before.id))continue;
    if(["type","at","status","employeeId","clockVerified"].every(k=>before[k as keyof typeof before]===after[k as keyof typeof after]))continue;
    handled.add(before.id);
    const current=people.flatMap(p=>p.contextRecords??p.days.flatMap(d=>d.records)).find(r=>r.id===before.id&&r.employeeId===after.employeeId);
    if(!current||["type","at","status","employeeId","clockVerified"].some(k=>current[k as keyof typeof current]!==after[k as keyof typeof after]))fail("A later local attendance decision prevents Undo. Review the current history.");
    const day=old.days.includes(workDate(before.at))?workDate(before.at):old.days[0];
    if(current.source==="API")changes.push({id:crypto.randomUUID(),day,kind:"UndoCapture",employeeId:current.employeeId,eventId:current.id,type:before.type as "IN"|"OUT",at:manilaWallTime(before.at).timestamp.replace(" ","T"),targetEmployeeId:before.employeeId,status:before.status,clockVerified:before.clockVerified,reason:"Undo local payroll override",evidence:"",verified:false});
    else if(current.source==="Manual"&&current.rawLogId!==undefined){
     if(before.at!==after.at)changes.push({id:crypto.randomUUID(),day,kind:"Time",employeeId:current.employeeId,rawLogId:current.rawLogId,at:manilaWallTime(before.at).timestamp.replace(" ","T"),reason:"Undo local payroll time",evidence:"",verified:false});
     if(before.type!==after.type)changes.push({id:crypto.randomUUID(),day,kind:"Direction",employeeId:current.employeeId,rawLogId:current.rawLogId,type:before.type as "IN"|"OUT",reason:"Undo local payroll direction",evidence:"",verified:false});
    }
   }
  }
 }
 for(const item of result?.changes??[]) {
  const before=JSON.parse(item.before_json),record=people.flatMap(p=>[...p.days.flatMap(d=>d.decision?.incomingRecords??[]),...(p.contextRecords??p.days.flatMap(d=>d.records))]).find(r=>r.id===item.event_id);
  if(!record||record.sourcePunch?.effectiveRevision!==item.revision)fail("A later source correction prevents Undo. Review its history before making a new correction.");
  const target=people.find(p=>p.sourceIds.includes(before.employeeId));if(!target)fail("Verify the original employee identity before Undo.");
  changes.push({id:crypto.randomUUID(),day:old.days.includes(workDate(before.capturedAt))?workDate(before.capturedAt):old.days[0],kind:"UndoCapture",employeeId:record.employeeId,eventId:item.event_id,type:before.type,at:manilaWallTime(before.capturedAt).timestamp.replace(" ","T"),targetEmployeeId:target.id,status:before.status,clockVerified:before.clockVerified,reason:"Undo prior correction",evidence:"",verified:false});
 }
 for(const prior of related){
  const owner=people.find(p=>p.id===prior.employeeId);if(!owner)fail("A related employee is no longer eligible. Review the employee record before Undo.");
  const add=(c:WorkDraft["changes"][number])=>changes.push({...c,employeeId:owner.id});
  const snapshots=await database.select().from(workTreatments).where(eq(workTreatments.planId,prior.id));
  const authoritative=snapshots.some(t=>adminDecision(t.payload));
  const priorDraft=prior.draft as WorkDraft;
  const manual=(await database.select().from(workRawLogs).where(eq(workRawLogs.planId,prior.id))).filter(r=>!authoritative||priorDraft.changes.some(c=>c.kind==="Manual"&&r.changeId.endsWith(":"+c.id)));
  if(authoritative)for(const c of priorDraft.changes.filter(c=>c.kind==="Exclude"||c.kind==="Retain"))add({...c,id:crypto.randomUUID(),kind:c.kind==="Exclude"?"Retain":"Exclude",reason:"Undo source selection",evidence:"",verified:false});
  for(const r of manual){const record=owner.days.flatMap(d=>d.records).find(p=>p.rawLogId===r.rawLogId);if(!record)fail("A later attendance change removed manual evidence. Review history before Undo.");add({id:crypto.randomUUID(),day:workDate(record.at),kind:"Exclude",rawLogId:r.rawLogId,reason:"Undo verified manual entry",evidence:"",verified:false});}
  const exclusions=authoritative?[]:await database.select().from(workExclusions).where(eq(workExclusions.planId,prior.id));
  for(const r of exclusions){const record=owner.days.flatMap(d=>d.records).find(p=>p.rawLogId===r.rawLogId);if(!record)fail("Competing attendance evidence changed. Review history before Undo.");add({id:crypto.randomUUID(),day:workDate(record.at),kind:r.active?"Retain":"Exclude",rawLogId:r.rawLogId,reason:"Undo source selection",evidence:"",verified:false});}
  const sourceExclusions=await database.select().from(workSourceExclusions).where(and(eq(workSourceExclusions.planId,prior.id),eq(workSourceExclusions.periodId,plan.periodId)));
  for(const r of sourceExclusions){const record=owner.days.flatMap(d=>d.records).find(p=>p.id===r.eventId);if(!record||r.version!==resolutionDigest(record.sourcePunch))fail("Source selection evidence changed. Review history before Undo.");add({id:crypto.randomUUID(),day:workDate(record.at),kind:r.active?"Retain":"Exclude",eventId:r.eventId,reason:"Undo source selection",evidence:"",verified:false});}
  for(const day of (prior.draft as WorkDraft).days)add({id:crypto.randomUUID(),day,kind:"ReopenDay",reason:"Undo prior attendance treatment",evidence:"",verified:false});
 }
 const ownerIds=[...new Set(changes.flatMap(c=>[c.employeeId??person.id,...(c.kind==="UndoCapture"&&c.targetEmployeeId?[c.targetEmployeeId]:[])]))];
 return ownerIds.map(owner=>{const target=people.find(p=>p.id===owner)!;const own=changes.filter(c=>(c.employeeId??person.id)===owner);for(const c of changes.filter(c=>c.kind==="UndoCapture"&&c.targetEmployeeId===owner&&c.employeeId!==owner))if(!own.some(x=>x.day===c.day))own.push({id:crypto.randomUUID(),day:c.day,kind:"ReopenDay",reason:"Review the other employee affected by Undo",evidence:"",verified:false});const days=[...new Set(own.map(c=>c.day))].sort();return {employeeId:owner,days,changes:own,ownerId:actor,reason:"Undo prior attendance resolution",needed:"Verify the reversal and downstream DTR impact",rejected:false,version:draftVersion(target,days),...(result?.changes?.length?{undoOf:(plan.sourceRequest as {id:string}).id}:{})} satisfies WorkDraft;});
}
