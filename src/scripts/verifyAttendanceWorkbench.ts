import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { matchingDatabase } from "./attendanceTest/matchingDatabase";
import { employees, employeesTimekeeping, payrollPeriods, attendanceRawLogs, payrollRuns } from "@/db/schema";
import { attendanceSourceMappings, attendanceSourceRuns } from "@/db/attendanceSourceSchema";
import { workPlans, workTreatments, workExclusions, adjustmentCases } from "@/db/attendanceWorkbenchSchema";
import { workEmployees, draftVersion, saveWorkDraft, prepareWorkApproval, approveWorkBatch, previewWork } from "@/lib/payroll/attendanceWorkbench";
import { processWorkDelivery, assertWorkbenchReady, undoWorkDraft, closeAdjustment } from "@/lib/payroll/attendanceWorkbenchDelivery";
import { sequenceProblems, simulateWork, dayStatus, suggestionsForDay, localToInstant, type WorkDraft, type WorkRecord } from "@/lib/payroll/attendanceWorkbenchModel";
import { reconcileAttendanceSource } from "@/lib/payroll/attendanceSourceSync";
import { pullAttendanceSource, type SourcePunch } from "@/lib/payroll/attendanceSourceClient";
import type { DbClient, db } from "@/db";

async function main(){
 process.env.ATTENDANCE_WORKBENCH_ENABLED="true";process.env.ATTENDANCE_SOURCE_ENABLED="true";process.env.ATTENDANCE_SOURCE_ORIGIN="https://fictional.invalid";process.env.ATTENDANCE_CORRECTION_TOKEN="fictional-correction-token-".repeat(3);
 const {pg,database,client}=await matchingDatabase();
 try {
 const actor=randomUUID(),employeeId=randomUUID(),periodId=randomUUID();
 await database.insert(employees).values({id:employeeId,employeeNo:"00003",firstName:"Example",lastName:"Employee"});
 await database.insert(employeesTimekeeping).values({employeeId,checkInTime:"08:00:00",checkOutTime:"17:00:00",hoursWorked:"8"});
 await database.insert(attendanceSourceMappings).values({sourceEmployeeId:"3",employeeId,actorUserId:actor,reason:"Verified fixture identity"});
 await database.insert(payrollPeriods).values({id:periodId,code:"FIXTURE-2026-09-B",payrollTerms:"Semi-Monthly",cycle:"B",year:2026,month:9,startDate:"2026-09-29",endDate:"2026-09-30",nominalPayDate:"2026-09-30",adjustedPayDate:"2026-09-30"});
 const punch=(type:"IN"|"OUT",at:string,reviewFlags:string[]=[]):SourcePunch=>({eventId:randomUUID(),employeeId:"3",employeeName:"Example Employee",originalEmployeeId:"3",originalEmployeeName:"Example Employee",branchId:"B1",type,originalType:type,capturedAt:at,originalCapturedAt:at,receivedAt:"2026-10-01T00:00:00.000Z",updatedAt:"2026-10-01T00:00:00.000Z",status:"VALID",clockFlag:false,clockVerified:false,reviewFlags,reviewResolved:false,correctionVersion:"original",effectiveRevision:"original",inRequestedWindow:true});
 let records=[punch("IN","2026-09-28T23:39:36.000Z"),punch("OUT","2026-09-29T09:09:00.000Z"),punch("OUT","2026-09-29T23:42:31.725Z",["CONSECUTIVE_OUT"]),punch("OUT","2026-09-30T09:07:54.000Z",["CONSECUTIVE_OUT"])];
 const moved={...records[2],capturedAt:"2026-10-02T00:00:00.000Z",effectiveRevision:randomUUID(),unifiedRevision:"a".repeat(64)};
 const exported:SourcePunch[][]=[];
 for(const [from,through,inRequestedWindow] of [["2026-09-01","2026-09-30",false],["2026-10-01","2026-10-15",true]] as const)exported.push(await pullAttendanceSource({origin:"https://fictional.invalid",token:"fixture-token-".repeat(4),version:3,from,through,fetcher:async()=>Response.json({schemaVersion:3,timeZone:"Asia/Manila",from,through,records:[{...moved,inRequestedWindow}],nextCursor:null})}));
 assert.deepEqual(exported[0],exported[1],"Date-window metadata cannot make period syncs invalidate each other");assert.equal(exported[0][0].inRequestedWindow,undefined);
 async function sync(){const id=randomUUID();await database.insert(attendanceSourceRuns).values({id,payrollPeriodId:periodId,actorUserId:actor,state:"Fetching",fromDate:"2026-09-28",throughDate:"2026-10-01",startedAt:sql`clock_timestamp()`});return reconcileAttendanceSource(database as unknown as typeof db,periodId,id,actor,records);}
 await sync();const person=(await workEmployees(periodId,client))[0],d=person.days.find(d=>d.day==="2026-09-30")!;
 assert.ok(d.suggestions.some(s=>s.changes[0].eventId===records[2].eventId&&s.changes[0].type==="IN"));
 const draft:WorkDraft={employeeId,days:[d.day],changes:[{id:randomUUID(),day:d.day,kind:"Direction",eventId:records[2].eventId,type:"IN",reason:"Supervisor verified wrong direction",evidence:"Fictional supervisor incident 42",verified:true}],reason:"Verified fixture",ownerId:actor,needed:"",rejected:false,version:draftVersion(person,[d.day])};
 const simulated=simulateWork(d.records,draft.changes,employeeId);assert.equal(simulated.records[0].at,records[2].capturedAt);assert.equal(simulated.records[1].type,"OUT");assert.equal(previewWork(person,draft).errors.length,0);
 const saved=await database.transaction(tx=>saveWorkDraft(tx as unknown as DbClient,actor,periodId,[draft]));
 const applied=new Map<string,unknown>();let loseResponse=true,writeCount=0;
 const fetcher:typeof fetch=async(_url,init)=>{const p=JSON.parse(String(init?.body));if(p.operation==="context")return Response.json({version:1,contextToken:"1".repeat(64),uploadCoverage:{state:"Confirmed",through:"2026-10-01T00:00:00.000Z"},records:records.filter(r=>p.employeeIds.includes(r.employeeId)).map(r=>({eventId:r.eventId,employeeId:r.employeeId,employeeName:r.employeeName,type:r.type,capturedAt:r.capturedAt,status:r.status,clockVerified:false,revision:r.effectiveRevision}))});if(p.operation==="plan-status")return Response.json(applied.get(p.id)??{state:"Not found",changes:[]});writeCount++;const changes=p.changes.map((c:{eventId:string;type:"IN"|"OUT"})=>{const before=records.find(r=>r.eventId===c.eventId)!,revision=randomUUID();const after={employeeId:before.employeeId,employeeName:before.employeeName,type:c.type,capturedAt:before.capturedAt,status:before.status,clockVerified:false};records=records.map(r=>({...r,...(r.eventId===c.eventId?{type:c.type,effectiveRevision:revision,updatedAt:"2026-10-05T00:00:00.000Z"}:{}),reviewFlags:[]}));return {event_id:c.eventId,revision,before_json:JSON.stringify({...after,type:before.type}),after_json:JSON.stringify(after)};});applied.set(p.id,{state:"Applied",changes});if(loseResponse){loseResponse=false;throw Error("Fictional timeout after source commit");}return Response.json({accepted:true});};
 const review=await prepareWorkApproval(periodId,saved.id,saved.revision,client,fetcher);
 await assert.rejects(()=>approveWorkBatch(actor,periodId,saved.id,saved.revision,"unacknowledged",database as unknown as typeof db,fetcher),/preview changed/);
 await approveWorkBatch(actor,periodId,saved.id,saved.revision,review.digest,database as unknown as typeof db,fetcher);
 await assert.rejects(()=>assertWorkbenchReady(periodId,client),/unfinished/);
 await processWorkDelivery(actor,{database:database as unknown as typeof db,batchId:saved.id,fetcher,sync});assert.equal((await database.select().from(workPlans))[0].state,"Failed");assert.equal(writeCount,1);
 await processWorkDelivery(actor,{database:database as unknown as typeof db,batchId:saved.id,fetcher,sync});assert.equal((await database.select().from(workPlans))[0].state,"Resolved");assert.equal(writeCount,1,"Retry must recover the already committed source result");
 await assertWorkbenchReady(periodId,client);assert.equal((await database.select().from(attendanceRawLogs)).length,4);const repeat=await sync();assert.equal(repeat.projected,0);
 const undo=await undoWorkDraft(client,actor,(await database.select().from(workPlans))[0].id);assert.equal(undo[0].changes.find(c=>c.kind==="UndoCapture")?.at,"2026-09-30T07:42:31.725");
 // Coverage includes employees without a single source punch; schedules are never invented.
 const missingId=randomUUID();await database.insert(employees).values({id:missingId,employeeNo:"00999",firstName:"No",lastName:"Punches"});const noPunch=(await workEmployees(periodId,client)).find(p=>p.id===missingId)!;assert.equal(noPunch.days[0].status,"Schedule missing");assert.ok(noPunch.days[0].issues.some(x=>x.includes("mapping")));
 await database.insert(employeesTimekeeping).values({employeeId:missingId,checkInTime:"08:00:00",checkOutTime:"17:00:00",hoursWorked:"8"});await database.insert(attendanceSourceMappings).values({sourceEmployeeId:"999",employeeId:missingId,actorUserId:actor,reason:"Fixture verified match"});
 const configured=(await workEmployees(periodId,client)).find(p=>p.id===missingId)!;
 const verified={reason:"Supervisor verified actual work",evidence:"Fictional source document 52",verified:true};
 const full:WorkDraft={employeeId:missingId,days:["2026-09-29","2026-09-30"],ownerId:actor,reason:verified.reason,needed:"",rejected:false,version:draftVersion(configured,["2026-09-29","2026-09-30"]),changes:[{id:randomUUID(),day:"2026-09-29",kind:"NoAttendance",...verified},{id:randomUUID(),day:"2026-09-30",kind:"Manual",type:"IN",at:"2026-09-30T08:00:00.123",...verified},{id:randomUUID(),day:"2026-09-30",kind:"Manual",type:"OUT",at:"2026-09-30T17:00:00.456",...verified}]};
 const fullSaved=await database.transaction(tx=>saveWorkDraft(tx as unknown as DbClient,actor,periodId,[full]));const fullPreview=await prepareWorkApproval(periodId,fullSaved.id,fullSaved.revision,client,fetcher);await approveWorkBatch(actor,periodId,fullSaved.id,fullSaved.revision,fullPreview.digest,database as unknown as typeof db,fetcher);await processWorkDelivery(actor,{database:database as unknown as typeof db,batchId:fullSaved.id,fetcher,sync});
 const manual=(await database.select().from(attendanceRawLogs)).filter(r=>r.employeeId===missingId);assert.equal(manual.length,2,"Full shift allowed with no original captures");assert.equal(manual[0].logTime,"08:00:00.123");assert.equal((await workEmployees(periodId,client)).find(p=>p.id===missingId)!.days.flatMap(d=>d.issues).length,0);await sync();assert.equal((await database.select().from(attendanceRawLogs)).filter(r=>r.employeeId===missingId).length,2,"Repeat sync cannot duplicate manual entries");
 const missing:WorkRecord={id:"missing",source:"API",employeeId,type:"IN",at:"2026-09-28T23:49:52.000Z",status:"VALID",clockFlag:false};assert.ok(sequenceProblems([missing],d.schedule).errors.includes("Missing OUT"));assert.equal(localToInstant("2026-09-31T10:00"),null);
 assert.equal(dayStatus({day:"2026-10-06",schedule:d.schedule,rest:false,leave:0,records:[],now:"2026-10-05T00:00:00Z"}),"Future");assert.equal(dayStatus({day:"2026-09-30",schedule:d.schedule,rest:false,leave:0,records:[],now:"2026-09-30T09:20:00Z"}),"In progress / awaiting upload");
 assert.equal(dayStatus({day:"2026-09-30",schedule:d.schedule,rest:true,leave:0,records:[],now:"2026-10-05T00:00:00Z"}),"Rest day");
 assert.ok(suggestionsForDay(d.day,d.records,d.schedule).length>1,"Ambiguous alternatives remain reviewable");
 const personNow=(await workEmployees(periodId,client)).find(p=>p.id===employeeId)!;
 const confirmation:WorkDraft={...draft,version:draftVersion(personNow,draft.days),changes:[{id:randomUUID(),day:d.day,kind:"ConfirmSequence",...verified}]};
 const staleSaved=await database.transaction(tx=>saveWorkDraft(tx as unknown as DbClient,actor,periodId,[confirmation]));const stalePreview=await prepareWorkApproval(periodId,staleSaved.id,staleSaved.revision,client,fetcher);
 await database.update(employeesTimekeeping).set({hoursWorked:"7.5"}).where(eq(employeesTimekeeping.employeeId,employeeId));
 await assert.rejects(()=>approveWorkBatch(actor,periodId,staleSaved.id,staleSaved.revision,stalePreview.digest,database as unknown as typeof db,fetcher),/evidence changed/);
 await database.update(employeesTimekeeping).set({hoursWorked:"8"}).where(eq(employeesTimekeeping.employeeId,employeeId));
 const concurrentPreview=await prepareWorkApproval(periodId,staleSaved.id,staleSaved.revision,client,fetcher);
 const concurrent=await Promise.allSettled([approveWorkBatch(actor,periodId,staleSaved.id,staleSaved.revision,concurrentPreview.digest,database as unknown as typeof db,fetcher),approveWorkBatch(actor,periodId,staleSaved.id,staleSaved.revision,concurrentPreview.digest,database as unknown as typeof db,fetcher)]);assert.equal(concurrent.filter(r=>r.status==="fulfilled").length,1,"Only one simultaneous approval may commit");
 await processWorkDelivery(actor,{database:database as unknown as typeof db,batchId:staleSaved.id,fetcher,sync});
 await database.insert(payrollRuns).values({payrollPeriodId:periodId,runNumber:1,status:"Posted"});const postedBefore=await database.select().from(payrollRuns),rawBefore=await database.select().from(attendanceRawLogs);
 const postedPerson=(await workEmployees(periodId,client)).find(p=>p.id===employeeId)!;
 const postedDraft:WorkDraft={...draft,version:draftVersion(postedPerson,draft.days),changes:[...records.slice(2).map(r=>({id:randomUUID(),day:d.day,kind:"Exclude" as const,eventId:r.eventId,...verified})),{id:randomUUID(),day:d.day,kind:"Manual",at:"2026-09-30T08:30:00",type:"IN",...verified},{id:randomUUID(),day:d.day,kind:"Manual",at:"2026-09-30T17:30:00",type:"OUT",...verified}]};
 const postedSaved=await database.transaction(tx=>saveWorkDraft(tx as unknown as DbClient,actor,periodId,[postedDraft]));const postedPreview=await prepareWorkApproval(periodId,postedSaved.id,postedSaved.revision,client,fetcher);await approveWorkBatch(actor,periodId,postedSaved.id,postedSaved.revision,postedPreview.digest,database as unknown as typeof db,fetcher);await processWorkDelivery(actor,{database:database as unknown as typeof db,batchId:postedSaved.id,fetcher,sync});
 assert.deepEqual(await database.select().from(payrollRuns),postedBefore,"Posted run is immutable");assert.deepEqual(await database.select().from(attendanceRawLogs),rawBefore,"Posted attendance inputs remain immutable");const adjustments=await database.select().from(adjustmentCases);assert.equal(adjustments.length,1);assert.ok(adjustments[0].impact);await assert.rejects(()=>database.transaction(tx=>closeAdjustment(tx as unknown as DbClient,actor,adjustments[0].id,"","",false)),/record evidence/);await database.transaction(tx=>closeAdjustment(tx as unknown as DbClient,actor,adjustments[0].id,"FIXTURE-ADJUSTMENT-42","Fictional verified adjustment is recorded",true));assert.equal((await database.select().from(adjustmentCases))[0].state,"Adjustment recorded");
 void workTreatments;void workExclusions;void payrollRuns;
 console.log("PASS: workbench coverage, precise direction correction, whole-batch acknowledgment, timeout recovery, idempotent reconciliation, Undo draft and unknown-time holds");
 }finally{await pg.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
