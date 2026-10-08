import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendanceDailySummaries, attendanceImportBatches, attendanceRawLogs, payrollRuns } from "@/db/schema";
import { attendanceSourceEvents as events, attendanceSourceMappings as mappings, attendanceSourceProjections as projections, attendanceSourceRuns as runs } from "@/db/attendanceSourceSchema";
import { workBatches, workPlans } from "@/db/attendanceWorkbenchSchema";
import { loadProvisionalPayroll } from "@/lib/payroll/provisional";
import { workEmployees, previewWork } from "@/lib/payroll/attendanceWorkbench";
import { loadEffectiveAttendanceInputSet } from "@/lib/payroll/effectiveAttendanceInputs";
import { reconcileAttendanceSource } from "@/lib/payroll/attendanceSourceSync";
import { persistAdminDecision } from "@/lib/payroll/attendanceAdminDecisionStore";
import { manilaWallTime, type SourcePunch } from "@/lib/payroll/attendanceSourceClient";
import type { WorkDraft } from "@/lib/payroll/attendanceWorkbenchModel";
import { rebuildEmployeeAttendanceSummaries } from "@/app/actions/shiftAssignmentHelpers";

async function fingerprint(){return (await db.execute(sql`select json_object_agg(table_name,fingerprint) as value from (select table_name,(xpath('/row/value/text()',query_to_xml(format('select md5(coalesce(string_agg(to_jsonb(t)::text, '''' order by to_jsonb(t)::text),'''')) as value from %I t',table_name),false,true,'')))[1]::text as fingerprint from information_schema.tables where table_schema='public' and table_type='BASE TABLE') x`)).rows;}
async function main(){
 const url=new URL(process.env.DATABASE_URL??"");assert.equal(url.hostname,"127.0.0.1");assert.match(url.pathname,/payroll_provisional_\d+_(?:gui|tests)$/);
 const fixture=JSON.parse(readFileSync(process.env.PROVISIONAL_FIXTURE_FILE!,"utf8")),employeeId=fixture.dailyEmployeeId,periodId=fixture.periodId,day="2026-10-04",priorDay="2026-10-03";
 const before=await fingerprint(),checks:string[]=[],rollback=new Error("rollback consolidation fixture");
 try {await db.transaction(async tx=>{
  const database={transaction:async(fn:(client:typeof tx)=>Promise<unknown>)=>fn(tx)} as unknown as typeof db;
  const sourceId=`PV-CONSOLIDATE-${randomUUID().slice(0,8)}`,at=(date:string,time:string)=>`${date}T${time}+08:00`;
  const punch=(type:"IN"|"OUT",capturedAt:string,reviewFlags:string[]=[]):SourcePunch=>({eventId:randomUUID(),branchId:"PV-QA",employeeId:sourceId,employeeName:"Fictional consolidation",originalEmployeeId:sourceId,originalEmployeeName:"Fictional consolidation",type,capturedAt,receivedAt:capturedAt,updatedAt:capturedAt,status:"VALID",clockFlag:false,reviewResolved:false,reviewFlags});
  const previous=punch("IN",at(priorDay,"17:04:37.108"),["CONSECUTIVE_IN","NO_FOLLOWING_OUT"]),inside=punch("IN",at(day,"07:44:01.126"),["CONSECUTIVE_IN"]),outside=punch("OUT",at(day,"17:05:22.836")),records=[previous,inside,outside];
  assert.equal((await tx.select().from(attendanceRawLogs).where(and(eq(attendanceRawLogs.employeeId,employeeId),eq(attendanceRawLogs.logDate,day)))).length,0,"Fixture date must start without captures");
  await tx.insert(mappings).values({sourceEmployeeId:sourceId,employeeId,actorUserId:"fixture",reason:"Rollback fixture"});
  await tx.insert(events).values(records.map(payload=>({eventId:payload.eventId,sourceEmployeeId:sourceId,capturedAt:new Date(payload.capturedAt),payload,firstPayload:payload})));
  const [batch]=await tx.insert(attendanceImportBatches).values({payrollPeriodId:periodId,sourceFileName:`attendance-api:consolidation-${randomUUID()}`,sourceFormat:"API",status:"Processed"}).returning();
  const wall=manilaWallTime(outside.capturedAt);
  const [rawOut]=await tx.insert(attendanceRawLogs).values({batchId:batch.id,employeeId,employeeNo:"PV-QA-001",direction:"OUT",loggedAt:sql`${wall.timestamp}::timestamp`,logDate:wall.date,logTime:wall.time,rawText:JSON.stringify(outside)}).returning();
  await tx.insert(projections).values(records.map(record=>({payrollPeriodId:periodId,eventId:record.eventId,employeeId,rawLogId:record.eventId===outside.eventId?rawOut.id:null,payloadHash:"fixture-unprojected"})));
  const read=()=>loadProvisionalPayroll({periodId,employeeId,group:"Daily",asOfDate:"2026-10-07"},database);
  const initial=await read(),initialDay=initial.rows[0].days.find(row=>row.date===day)!;
  assert.equal(initialDay.regularMinutes,480);assert.equal(initialDay.status,"Recorded");assert.equal(initialDay.attendance!.complete,true);assert.deepEqual(initialDay.attendance!.issues,[]);
  assert.equal(initial.rows[0].days.find(row=>row.date===priorDay)!.regularMinutes,0,"Malformed previous day not repaired");
  const [employee]=await workEmployees(periodId,tx,undefined,undefined,employeeId),editorDay=employee.days.find(row=>row.day===day)!;
  assert.deepEqual(editorDay.attendance,initialDay.attendance,"Editor and estimate share exact inclusion/finding contract");assert.equal(editorDay.issues.length,0);
  assert.equal((await tx.select().from(projections).where(eq(projections.eventId,inside.eventId)))[0].rawLogId,null,"Display did not persist a raw projection");
  checks.push("Complete current-day pair counts immediately despite prior-day phone flag; editor/estimate agree; no read mutation");
  await tx.execute(sql`savepoint dtr_cached_source`);
  await rebuildEmployeeAttendanceSummaries({tx,employeeId,startDate:day,endDate:day});
  const [summary]=await tx.select().from(attendanceDailySummaries).where(and(eq(attendanceDailySummaries.employeeId,employeeId),eq(attendanceDailySummaries.attendanceDate,day)));
  assert.equal(summary.regularMinutes,480);assert.equal(summary.sourceBatchId,null,"Virtual source batch never becomes a foreign key");
  await tx.execute(sql`rollback to savepoint dtr_cached_source`);checks.push("Actual schedule/DTR rebuild accepts cached facts without persisting virtual source identifiers");
  await tx.execute(sql`savepoint held_clock`);
  const clock={...inside,clockFlag:true};await tx.update(events).set({payload:clock}).where(eq(events.eventId,inside.eventId));
  const clockDay=(await read()).rows[0].days.find(row=>row.date===day)!;assert.equal(clockDay.regularMinutes,0);assert(clockDay.attendance!.issues.some(issue=>issue.includes("clock")));assert.equal(clockDay.attendance!.canConfirmExisting,false);
  const [clockEmployee]=await workEmployees(periodId,tx,undefined,undefined,employeeId);
  const draft:WorkDraft={employeeId,days:[day],changes:[{id:randomUUID(),kind:"ConfirmSequence",day,reason:"",evidence:"",verified:false}],reason:"",ownerId:"fixture",needed:"",rejected:false,version:"fixture"};
  assert(previewWork(clockEmployee,draft).errors.some(error=>error.includes("capture time")),"Server rejects confirmation that bypasses a clock review");
  await tx.execute(sql`rollback to savepoint held_clock`);checks.push("Genuine clock hold remains visible and cannot be bypassed by Confirm existing");
  await tx.execute(sql`savepoint protected_payroll`);
  const [run]=await tx.insert(payrollRuns).values({payrollPeriodId:periodId,runNumber:999,status:"Posted",runType:"Regular",inputSnapshot:{}}).returning();
  for(const status of ["Draft","Stale","Reviewed","Approved","Posted"] as const){
   await tx.update(payrollRuns).set({status}).where(eq(payrollRuns.id,run.id));
   const current=(await read()).rows[0].days.find(row=>row.date===day)!;
   assert.equal(current.regularMinutes,["Draft","Stale"].includes(status)?480:0,`${status} current-input policy`);
   assert.deepEqual((await tx.select().from(payrollRuns).where(eq(payrollRuns.id,run.id)))[0].inputSnapshot,{},"Stored snapshot never changed by display");
  }
  const frozen=(await read()).rows[0].days.find(row=>row.date===day)!;assert.equal(frozen.regularMinutes,0);assert(frozen.attendance!.issues.some(issue=>issue.includes("retained")));
  assert.equal((await tx.select().from(payrollRuns).where(eq(payrollRuns.id,run.id)))[0].status,"Posted");
  await tx.execute(sql`rollback to savepoint protected_payroll`);checks.push("Draft/Stale current estimates update; Reviewed/Approved/legacy Posted inputs stay protected and every stored snapshot remains intact");
  await tx.execute(sql`savepoint approved_attendance`);
  const [decisionBatch]=await tx.insert(workBatches).values({periodId,actor:"fixture"}).returning();
  const [plan]=await tx.insert(workPlans).values({batchId:decisionBatch.id,periodId,employeeId,draft,state:"Resolved",evidenceVersion:"fixture",ownerId:"fixture"}).returning();
  await persistAdminDecision(tx,{periodId,planId:plan.id,actor:"fixture",employeeNo:"PV-QA-001",draft:{...draft,changes:[]},records:[],sourceRecords:[],warnings:[]});
  assert.equal((await read()).rows[0].days.find(row=>row.date===day)!.regularMinutes,0,"No-work decision remains authoritative");
  const conflict=(await read()).rows[0].days.find(row=>row.date===day)!.attendance!;
  assert.equal(conflict.lateConflict,true);assert.equal(conflict.canConfirmExisting,false);assert(conflict.issues.some(issue=>issue.includes("approved decision retained")));
  await tx.execute(sql`rollback to savepoint approved_attendance`);checks.push("Approved no-work decision is not expanded by cached source evidence");
  const [sync]=await tx.insert(runs).values({payrollPeriodId:periodId,state:"Fetching",actorUserId:"fixture",fromDate:"2026-09-30",throughDate:"2026-10-16"}).returning();
  await reconcileAttendanceSource(database,periodId,sync.id,"fixture",records);
  assert((await tx.select().from(projections).where(eq(projections.eventId,inside.eventId)))[0].rawLogId!=null,"Sync uses same day eligibility and materializes the existing real IN");
  assert.equal((await tx.select().from(projections).where(eq(projections.eventId,previous.eventId)))[0].rawLogId,null);
  assert.equal((await read()).rows[0].days.find(row=>row.date===day)!.regularMinutes,480);
  assert.deepEqual((await tx.select().from(events).where(eq(events.eventId,inside.eventId)))[0].payload,inside,"Original source flags/facts unchanged");
  assert.equal((await loadEffectiveAttendanceInputSet(tx,{employeeIds:[employeeId],startDate:day,endDate:day})).punches.filter(p=>p.day===day&&p.included).length,2,"Cached and projected real event never counted twice");
  checks.push("Sync/read eligibility parity, deduplication, original phone evidence preserved");
  await tx.execute(sql`savepoint projected_warning`);
  const [projectedIn]=await tx.select().from(projections).where(eq(projections.eventId,inside.eventId));
  const [storedIn]=await tx.select().from(attendanceRawLogs).where(eq(attendanceRawLogs.id,projectedIn.rawLogId!));
  await tx.update(events).set({payload:{...inside,clockFlag:true}}).where(eq(events.eventId,inside.eventId));
  const [changingRun]=await tx.insert(payrollRuns).values({payrollPeriodId:periodId,runNumber:999,status:"Draft",runType:"Regular",inputSnapshot:{payrollGroup:"Daily"}}).returning();
  for(const status of ["Draft","Stale","Reviewed","Approved","Posted"] as const){
   await tx.update(payrollRuns).set({status}).where(eq(payrollRuns.id,changingRun.id));
   const changedDay=(await read()).rows[0].days.find(row=>row.date===day)!;
   assert.equal(changedDay.regularMinutes,["Draft","Stale"].includes(status)?0:480,`${status}: newly received clock warning respects protected imported input`);
   if(["Draft","Stale"].includes(status)){assert(changedDay.attendance!.issues.some(issue=>issue.includes("clock")));assert.equal(changedDay.attendance!.canConfirmExisting,false);}
  }
  await tx.update(payrollRuns).set({status:"Stale"}).where(eq(payrollRuns.id,changingRun.id));
  await tx.update(events).set({payload:{...inside,reviewFlags:["IDENTITY_CONFLICT"]}}).where(eq(events.eventId,inside.eventId));
  const identityDay=(await read()).rows[0].days.find(row=>row.date===day)!;assert.equal(identityDay.regularMinutes,0);assert(identityDay.attendance!.issues.some(issue=>issue.includes("investigation")));assert.equal(identityDay.attendance!.canConfirmExisting,false);
  const [explicitBatch]=await tx.insert(workBatches).values({periodId,actor:"fixture"}).returning();
  const [explicitPlan]=await tx.insert(workPlans).values({batchId:explicitBatch.id,periodId,employeeId,draft,state:"Resolved",evidenceVersion:"fixture",ownerId:"fixture"}).returning();
  const acceptedRecords=[inside,outside].map(punch=>({id:punch.eventId,source:"API" as const,employeeId,type:punch.type,at:punch.capturedAt,status:punch.status,clockFlag:false}));
  await persistAdminDecision(tx,{periodId,planId:explicitPlan.id,actor:"fixture",employeeNo:"PV-QA-001",draft,records:acceptedRecords,sourceRecords:acceptedRecords,warnings:[]});
  assert.equal((await read()).rows[0].days.find(row=>row.date===day)!.regularMinutes,480,"Explicit admin decision remains authoritative despite later source warning");
  assert.deepEqual((await tx.select().from(attendanceRawLogs).where(eq(attendanceRawLogs.id,storedIn.id)))[0],storedIn,"Read-time safety finding never rewrites the imported original");
  assert.deepEqual((await tx.select().from(events).where(eq(events.eventId,inside.eventId)))[0].firstPayload,inside,"Original phone evidence remains unchanged");
  await tx.execute(sql`rollback to savepoint projected_warning`);checks.push("Later clock/identity warning on a projected capture is held immediately for Draft/Stale, preserving approved/posted inputs and all originals");
  throw rollback;
 });}catch(error){if(error!==rollback)throw error;}
 assert.deepEqual(await fingerprint(),before,"All restored tables unchanged after rollback suite");checks.push("All-table fingerprints unchanged; no production access or phone writes");
 console.log(JSON.stringify({passed:true,checks,productionAccess:false}));
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
