import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { payrollRunEmployees, payrollRunLines, payrollRuns, payrollRunEvents } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { createOrRecomputePayrollRun } from "@/lib/payroll/engine";
import { findComputeReceipt } from "@/lib/payroll/computeReceipt";
async function main(){
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/payroll_stage6_acceptance_20261007");
 const id="49b9dff5-9024-4b69-8ac7-76e947d78e1d",periodId="8495e00a-8a51-49a2-9904-9f63ac4f53db";
 const [run]=await db.select().from(payrollRuns).where(eq(payrollRuns.id,id));assert.ok(["Draft","Stale"].includes(run.status));assert.ok(run.computedByUserId);
 const snapshot=async()=>{
  const rows=await db.select().from(payrollRunEmployees).where(eq(payrollRunEmployees.payrollRunId,id)).orderBy(payrollRunEmployees.employeeNoSnapshot);
  const lines=await db.select({employeeId:payrollRunEmployees.employeeId,lineType:payrollRunLines.lineType,code:payrollRunLines.code,amount:payrollRunLines.amount,quantity:payrollRunLines.quantity,rate:payrollRunLines.rate,sourceTable:payrollRunLines.sourceTable,sourceId:payrollRunLines.sourceId}).from(payrollRunLines).innerJoin(payrollRunEmployees,eq(payrollRunEmployees.id,payrollRunLines.payrollRunEmployeeId)).where(eq(payrollRunEmployees.payrollRunId,id));
  return {rows:rows.map(r=>({employeeId:r.employeeId,regularPay:r.regularPay,grossPay:r.grossPay,totalDeductions:r.totalDeductions,employeeContributions:r.employeeContributions,employerContributions:r.employerContributions,taxablePay:r.taxablePay,netPay:r.netPay})),lines:lines.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
 };
 const before=await snapshot(),requestId=randomUUID(),actor=run.computedByUserId!;
 let baselineMs:number|null=null;
 if(process.env.STAGE6_BASELINE_ENGINE){const baseline=await import(pathToFileURL(process.env.STAGE6_BASELINE_ENGINE).href);const started=Date.now();await baseline.createOrRecomputePayrollRun(periodId,actor,{payrollGroup:"Daily",bypassTemporaryReadinessCategories:true});baselineMs=Date.now()-started;assert.deepEqual(await snapshot(),before,"Baseline calculation preserves all amounts too");}
 const start=Date.now();const computed=await createOrRecomputePayrollRun(periodId,actor,{payrollGroup:"Daily",bypassTemporaryReadinessCategories:true,requestId});const ms=Date.now()-start;
 assert.equal(computed?.id,id);assert.equal(computed?.status,"Draft");assert.deepEqual(await snapshot(),before,"All 277 stored employee amounts and every payroll line are unchanged");
 const events=async()=>(await db.select({count:sql<number>`count(*)::int`}).from(payrollRunEvents).where(and(eq(payrollRunEvents.payrollRunId,id),eq(payrollRunEvents.eventType,"Computed"))))[0].count;
 const raceId=randomUUID(),raceCount=await events();await Promise.all([createOrRecomputePayrollRun(periodId,actor,{payrollGroup:"Daily",bypassTemporaryReadinessCategories:true,requestId:raceId}),createOrRecomputePayrollRun(periodId,actor,{payrollGroup:"Daily",bypassTemporaryReadinessCategories:true,requestId:raceId})]);assert.equal(await events(),raceCount+1,"Two initially unrecorded requests save exactly once under the input lock");
 const count=await events(),replayStart=Date.now();await Promise.all([createOrRecomputePayrollRun(periodId,actor,{payrollGroup:"Daily",bypassTemporaryReadinessCategories:true,requestId}),createOrRecomputePayrollRun(periodId,actor,{payrollGroup:"Daily",bypassTemporaryReadinessCategories:true,requestId})]);
 assert.equal(await events(),count);assert.deepEqual(await snapshot(),before);
 assert.equal((await findComputeReceipt(actor,{periodId,requestId,group:"Daily",bypass:true}))?.runId,id);
 console.log(JSON.stringify({passed:true,environment:"separate local restored backup",baselineMs,computeMs:ms,comparison:"one local sample each; baseline first, same restored database and rule helpers",twoConcurrentReceiptReplaysMs:Date.now()-replayStart,employees:before.rows.length,lines:before.lines.length,amountsUnchanged:true,duplicateWrites:0,postingPerformed:false}));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
