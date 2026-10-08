import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { loadWorkBoard } from "@/lib/payroll/attendanceWorkbench";
import { dayNeedsReview, isActiveWorkPlan } from "@/lib/payroll/attendanceWorkbenchModel";

async function main(){
 assert.equal(new URL(process.env.DATABASE_URL!).hostname,"127.0.0.1","Restored LOCAL database only");
 await db.transaction(async tx=>{
  await tx.execute(sql`set transaction read only`);
  const board=await loadWorkBoard("8495e00a-8a51-49a2-9904-9f63ac4f53db",tx);
  const cases=board.employees.flatMap(e=>e.days.filter(dayNeedsReview).map(d=>({employee:e.name,day:d.day,status:d.status,issues:d.issues,effective:d.records.filter(r=>r.status==="VALID"&&!r.excluded).map(r=>({type:r.type,at:r.at,source:r.source})),incoming:d.decision?.incomingRecords.filter(r=>r.status==="VALID"&&!r.excluded).map(r=>({type:r.type,at:r.at,source:r.source}))})));
  const history=board.plans.filter(isActiveWorkPlan).map(p=>({employee:board.employees.find(e=>e.id===p.draft.employeeId)?.name,state:p.state,approved:p.approved,historicalDeliveryPending:p.historicalDeliveryPending,days:p.draft.days,changes:p.draft.changes.length}));
  console.log(JSON.stringify({readOnly:true,statuses:board.statuses,correctionTasks:cases.length,cases,unfinishedHistory:history},null,2));
  assert.equal(board.period.posted,true);assert.equal(board.adjustments.filter(a=>a.state==="Open").length,0);
  assert.equal(cases.length,0,"Posted September Daily should have zero actual attendance repair tasks; historical drafts remain separate");
 });
 console.log("PASS restored September posted board is truthful and read-only");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
