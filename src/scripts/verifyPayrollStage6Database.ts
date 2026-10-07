import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { authAccounts, employees, employeesGeneralInfo, employeeShiftAssignments, payrollPeriods, payrollRuns, payrollRunEmployees, shiftTables } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { prepareBulkDaySchedules, saveBulkDaySchedules, bulkScheduleReceipt } from "@/lib/payroll/bulkDaySchedules";
import { findComputeReceipt, recordComputeReceipt } from "@/lib/payroll/computeReceipt";
import { computeBirWithholding, computePagibigContribution, computePhilhealthContribution, computeSssContribution, getActiveStatutoryRuleBundle, loadStatutoryCalculationRules } from "@/lib/payroll/statutory";

async function main(){
 assert.equal(new URL(process.env.DATABASE_URL!).hostname,"127.0.0.1");
 const versions=await getActiveStatutoryRuleBundle("2026-10-05"),rules=await loadStatutoryCalculationRules(versions);
 for(const amount of [0,1,5000,15000,20000,35000,60000,100000,1000000]){
  if(versions.sssVersionId)assert.deepEqual(await computeSssContribution(amount,versions.sssVersionId,rules),await computeSssContribution(amount,versions.sssVersionId));
  if(versions.philhealthVersionId)assert.deepEqual(await computePhilhealthContribution(amount,versions.philhealthVersionId,rules),await computePhilhealthContribution(amount,versions.philhealthVersionId));
  if(versions.pagibigVersionId)assert.deepEqual(await computePagibigContribution(amount,versions.pagibigVersionId,rules),await computePagibigContribution(amount,versions.pagibigVersionId));
  if(versions.taxVersionId)assert.equal(await computeBirWithholding(amount,versions.taxVersionId,"Semi-Monthly",rules),await computeBirWithholding(amount,versions.taxVersionId));
 }
 await assert.rejects(()=>computeSssContribution(1000,-1,rules),/version mismatch/);
 const tables=["employees_general_info","payroll_periods","payroll_runs","payroll_run_employees","payroll_run_events","employee_shift_assignments","attendance_daily_summaries","admin_audit_events"];
 const fingerprint=async()=>(await db.execute(sql.raw(tables.map(t=>`select '${t}' as name,count(*)::int as count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as hash from ${t} t`).join(" union all ")))).rows;
 const before=await fingerprint(),rollback=new Error("rollback");
 try{await db.transaction(async tx=>{
  const database={...db,transaction:async(fn:(client:typeof tx)=>Promise<unknown>)=>fn(tx)} as typeof db;
  const [actor]=await tx.select().from(authAccounts).limit(1),[person]=await tx.select().from(employees).limit(1),[shift]=await tx.select().from(shiftTables).limit(1);
  await tx.update(employeesGeneralInfo).set({dateHired:"2020-01-01",separationDate:null}).where(eq(employeesGeneralInfo.employeeId,person.id));
  await tx.delete(employeeShiftAssignments).where(eq(employeeShiftAssignments.employeeId,person.id));
  const periodId=randomUUID();await tx.insert(payrollPeriods).values({id:periodId,code:`S6-${periodId.slice(0,8)}`,year:2098,month:9,cycle:"B",payrollTerms:"Semi-Monthly",startDate:"2098-09-16",endDate:"2098-09-30",nominalPayDate:"2098-10-05",adjustedPayDate:"2098-10-05",status:"Open"});
  const input={requestId:randomUUID(),periodId,shiftTableId:shift.id,targets:[{employeeId:person.id,day:"2098-09-29"},{employeeId:person.id,day:"2098-09-30"}]};
  const preview=await prepareBulkDaySchedules(tx,input);
  await assert.rejects(()=>saveBulkDaySchedules({userId:actor.id},input,"old-digest",database),/changed/);
  assert.equal((await tx.select().from(employeeShiftAssignments).where(eq(employeeShiftAssignments.employeeId,person.id))).length,0);
  const saved=await saveBulkDaySchedules({userId:actor.id},input,preview.digest,database);assert.equal(saved.saved,2);
  assert.equal((await saveBulkDaySchedules({userId:actor.id},input,preview.digest,database)).saved,2,"Replay returns receipt despite changed source digest");
  assert.equal((await tx.select().from(employeeShiftAssignments).where(eq(employeeShiftAssignments.employeeId,person.id))).length,2);
  assert.equal((await bulkScheduleReceipt(tx,actor.id,input.requestId))?.saved,2);
  assert.equal(await bulkScheduleReceipt(tx,randomUUID(),input.requestId),null);
  await assert.rejects(()=>saveBulkDaySchedules({userId:actor.id},{...input,targets:input.targets.slice(0,1)},preview.digest,database),/different dates/);
  await assert.rejects(()=>prepareBulkDaySchedules(tx,{...input,targets:[{employeeId:person.id,day:"2098-09-31"}]}),/Invalid workday/);
  await assert.rejects(()=>prepareBulkDaySchedules(tx,{...input,targets:[{employeeId:person.id,day:"2098-10-01"}]}),/outside/);
  const runId=randomUUID();await tx.insert(payrollRuns).values({id:runId,payrollPeriodId:periodId,runNumber:1,status:"Posted",inputSnapshot:{payrollGroup:"Daily"}});
  await tx.insert(payrollRunEmployees).values({payrollRunId:runId,employeeId:person.id,employeeNoSnapshot:person.employeeNo,employeeNameSnapshot:"Stage 6 fixture"});
  const blocked={...input,requestId:randomUUID()};const blockedPreview=await prepareBulkDaySchedules(tx,blocked);
  await assert.rejects(()=>saveBulkDaySchedules({userId:actor.id},blocked,blockedPreview.digest,database),/Posted/);
  assert.equal(await bulkScheduleReceipt(tx,actor.id,blocked.requestId),null);
  const request={requestId:randomUUID(),periodId,group:"Daily" as const,bypass:true};
  assert.equal(await findComputeReceipt(actor.id,request,tx),null);await recordComputeReceipt(actor.id,request,runId,tx);
  assert.equal((await findComputeReceipt(actor.id,request,tx))?.runId,runId);
  assert.equal(await findComputeReceipt(randomUUID(),request,tx),null);
  await assert.rejects(()=>findComputeReceipt(actor.id,{...request,group:"Monthly"},tx),/different payroll inputs/);
  throw rollback;
 });}catch(error){if(error!==rollback)throw error;}
 assert.deepEqual(await fingerprint(),before,"Every fixture write rolled back");
 console.log("PASS restored Stage 6: statutory results identical at 9 salary boundaries, two-date schedule save, exact scope, idempotent replay, stale/invalid/posted protection, actor-scoped compute receipts and rollback");
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
