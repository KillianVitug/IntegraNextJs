import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { authAccounts, employees, payrollPeriods, payrollRunEmployees, payrollRunEvents, payrollRunLines, payrollRuns } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { transitionPayrollRunStatus } from "@/lib/payroll/engine";
import { attendancePayrollSnapshot } from "@/lib/payroll/attendanceSourceGuard";
import { allocateShortfallRecovery, recoveryLine, SHORTFALL_POLICY } from "@/lib/payroll/shortfallModel";
import { assertShortfallReversal, loadShortfallBalances } from "@/lib/payroll/shortfalls";

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1", "Restored local database only");
  const tables = ["payroll_periods", "payroll_runs", "payroll_run_employees", "payroll_run_lines", "payroll_run_events", "loan_installments", "loan_payments"];
  const fingerprint = async () => (await db.execute(sql.raw(tables.map(table => `select '${table}' as name,count(*)::int as count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) as hash from ${table} t`).join(" union all ")))).rows;
  const before = await fingerprint();
  const rollback = new Error("Fixture rollback");
  try { await db.transaction(async tx => {
    const database = {...db, transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)} as typeof db;
    const [actor] = await tx.select().from(authAccounts).limit(1);
    const people = await tx.select().from(employees).limit(2);
    assert.equal(people.length, 2);
    const employeeIds = people.map(row => row.id);
    const ledger = (date = "2098-12-01") => loadShortfallBalances(employeeIds, date, tx);
    const move = (id: string, status: "Reviewed" | "Approved" | "Posted" | "Void", ack = false) => transitionPayrollRunStatus(id, status, actor.id, "Fictional recovery acceptance", database, {actorRole: "ADMIN", acknowledgeShortfalls: ack});
    async function create(month: number, amounts: {gross: number; deductions: number}[], withRecovery = true) {
      const id = randomUUID(), periodId = randomUUID(), date = `2098-${String(month).padStart(2,"0")}-01`;
      await tx.insert(payrollPeriods).values({id: periodId, code: `REC-${id.slice(0,8)}`, year: 2098, month, cycle: "A", payrollTerms: "Semi-Monthly", startDate: date, endDate: date.slice(0,8)+"15", nominalPayDate: date.slice(0,8)+"20", adjustedPayDate: date.slice(0,8)+"20", status: "Open"});
      const opening = await ledger(date);
      await tx.insert(payrollRuns).values({id, payrollPeriodId: periodId, runNumber: 1, status: "Draft", inputSnapshot: withRecovery ? {payrollGroup: "Daily", shortfallPolicy: SHORTFALL_POLICY, shortfallDigest: opening.digest, shortfallBalances: opening.balances} : {payrollGroup: "Daily"}});
      for (const [index, person] of people.entries()) {
        const amount = amounts[index];
        const allocations = withRecovery ? allocateShortfallRecovery(opening.balances, person.id, amount.gross-amount.deductions) : [];
        const recovery = allocations.reduce((sum, row) => sum+row.amountCents,0)/100;
        const [employee] = await tx.insert(payrollRunEmployees).values({payrollRunId:id,employeeId:person.id,employeeNoSnapshot:person.employeeNo,employeeNameSnapshot:`Fictional recovery ${index}`,grossPay:amount.gross.toFixed(2),totalDeductions:(amount.deductions+recovery).toFixed(2),netPay:(amount.gross-amount.deductions-recovery).toFixed(2)}).returning();
        await tx.insert(payrollRunLines).values([
          {payrollRunEmployeeId:employee.id,lineType:"Earning",code:"REG",description:"Fictional earnings",amount:amount.gross.toFixed(2)},
          {payrollRunEmployeeId:employee.id,lineType:"Deduction",code:"SSS",description:"Fictional current contribution",amount:amount.deductions.toFixed(2)},
          ...allocations.map(row=>({...recoveryLine(row),payrollRunEmployeeId:employee.id,amount:(row.amountCents/100).toFixed(2)})),
        ]);
      }
      await tx.insert(payrollRunEvents).values({payrollRunId:id,actorUserId:actor.id,eventType:"Computed",notes:JSON.stringify({attendanceSourceInputRunId:await attendancePayrollSnapshot(tx,periodId)})});
      return id;
    }
    const legacy = await create(8,[{gross:100,deductions:999},{gross:100,deductions:999}],false);
    await tx.update(payrollRuns).set({status:"Posted"}).where(eq(payrollRuns.id,legacy));
    assert.equal((await ledger()).balances.length,0,"Legacy negative pay never becomes automatic debt without an approved policy");
    const source = await create(9,[{gross:337.50,deductions:757.58},{gross:590.63,deductions:757.58}],false);
    assert.equal((await ledger()).balances.length,0,"Draft creates no debt");
    await move(source,"Reviewed");
    await assert.rejects(()=>move(source,"Approved"),/shortfalls/);
    await move(source,"Approved",true);
    assert.equal((await ledger()).balances.length,0,"Approval alone creates no debt");
    await move(source,"Posted"); await move(source,"Posted");
    assert.deepEqual((await ledger()).balances.map(row=>row.remainingCents).sort((a,b)=>a-b),[16695,42008]);
    const october = await create(10,[{gross:200,deductions:0},{gross:500,deductions:400}]);
    const competing = await create(11,[{gross:1000,deductions:0},{gross:1000,deductions:0}]);
    await move(october,"Reviewed"); await move(october,"Approved");
    await move(competing,"Reviewed"); await move(competing,"Approved");
    assert.equal((await ledger()).balances.reduce((sum,row)=>sum+row.remainingCents,0),58703,"Neither draft nor approval collects balances");
    await move(october,"Posted"); await move(october,"Posted");
    assert.deepEqual((await ledger()).balances.map(row=>row.remainingCents).sort((a,b)=>a-b),[6695,22008],"Partial recovery leaves exact remainder");
    await assert.rejects(()=>move(competing,"Posted"),/Shortfall balances changed/);
    assert.equal((await tx.query.payrollRuns.findFirst({where:eq(payrollRuns.id,competing)}))?.status,"Approved","Failed post leaves run unchanged");
    await move(competing,"Void");
    const missing = await create(11,[{gross:0,deductions:0},{gross:0,deductions:0}]);
    await move(missing,"Reviewed"); await move(missing,"Approved"); await move(missing,"Posted");
    assert.deepEqual((await ledger()).balances.map(row=>row.remainingCents).sort((a,b)=>a-b),[6695,22008],"No work does not collect balances");
    const omission = await create(12,[{gross:1000,deductions:0},{gross:1000,deductions:0}],false);
    await assert.rejects(()=>move(omission,"Reviewed"),/Outstanding shortfalls/);
    const final = await create(12,[{gross:1000,deductions:0},{gross:1000,deductions:0}]);
    await move(final,"Reviewed"); await move(final,"Approved"); await move(final,"Posted"); await move(final,"Posted");
    assert.equal((await ledger("2099-01-01")).balances.length,0,"Fully recovered balances are no longer charged");
    const finalEmployees = await tx.select().from(payrollRunEmployees).where(eq(payrollRunEmployees.payrollRunId,final));
    assert.deepEqual(finalEmployees.map(row=>row.netPay).sort(),["779.92","933.05"]);
    await assert.rejects(()=>assertShortfallReversal({runType:"Reversal",status:"Approved",inputSnapshot:{reversedPayrollRunId:source},payrollPeriod:null,employees:[]},tx),/already been recovered/);
    // A posted reversal of recovery restores only that linked balance.
    const original = await tx.query.payrollRuns.findFirst({where:eq(payrollRuns.id,final),with:{employees:{with:{lines:true}}}});
    const reversalId=randomUUID();
    await tx.insert(payrollRuns).values({id:reversalId,payrollPeriodId:original!.payrollPeriodId,runType:"Reversal",status:"Posted",inputSnapshot:{reversedPayrollRunId:final}});
    for(const employee of original!.employees){
      const [reversed]=await tx.insert(payrollRunEmployees).values({payrollRunId:reversalId,employeeId:employee.employeeId,employeeNoSnapshot:employee.employeeNoSnapshot,employeeNameSnapshot:"Fictional reversal"}).returning();
      await tx.insert(payrollRunLines).values(employee.lines.filter(row=>row.code==="SHORTFALL_RECOVERY").map(row=>({payrollRunEmployeeId:reversed.id,lineType:"Deduction" as const,code:row.code,description:"Reversed recovery",amount:(-Number(row.amount)).toFixed(2),sourceTable:row.sourceTable,sourceId:row.sourceId})));
    }
    assert.deepEqual((await ledger("2099-01-01")).balances.map(row=>row.remainingCents).sort((a,b)=>a-b),[6695,22008],"Recovery reversal restores exactly what was recovered");
    throw rollback;
  }); } catch(error) { if(error!==rollback) throw error; }
  assert.deepEqual(await fingerprint(),before,"Restored fixture changes fully rolled back");
  // Committed local-only fixtures are required for two independent connections to
  // see the same balances. Scope cleanup to the generated period IDs, then verify
  // every affected table against the original restored snapshot again.
  const fixturePeriods: string[] = [], candidates: string[] = [];
  let actorId = "", employeeId = "";
  try {
    await db.transaction(async tx => {
      const [actor] = await tx.select().from(authAccounts).limit(1);
      const [person] = await tx.select().from(employees).limit(1);
      actorId = actor.id; employeeId = person.id;
      let sourceId = "";
      for (const month of [9,10,11]) {
        const periodId = randomUUID(), runId = randomUUID(), date = `2096-${String(month).padStart(2,"0")}-01`;
        fixturePeriods.push(periodId);
        await tx.insert(payrollPeriods).values({id:periodId,code:`RACE-${periodId.slice(0,8)}`,year:2096,month,cycle:"A",payrollTerms:"Semi-Monthly",startDate:date,endDate:date.slice(0,8)+"15",nominalPayDate:date.slice(0,8)+"20",adjustedPayDate:date.slice(0,8)+"20",status:"Open"});
        const opening = await loadShortfallBalances([person.id],date,tx);
        await tx.insert(payrollRuns).values({id:runId,payrollPeriodId:periodId,status:month===9?"Posted":"Approved",inputSnapshot:{payrollGroup:"Daily",shortfallPolicy:SHORTFALL_POLICY,shortfallDigest:opening.digest,shortfallBalances:opening.balances},approvedByUserId:actor.id});
        const [employee] = await tx.insert(payrollRunEmployees).values({payrollRunId:runId,employeeId:person.id,employeeNoSnapshot:person.employeeNo,employeeNameSnapshot:"Fictional simultaneous recovery",grossPay:month===9?"100.00":"1000.00",totalDeductions:"200.00",netPay:month===9?"-100.00":"800.00"}).returning();
        if(month===9) sourceId=employee.id;
        await tx.insert(payrollRunLines).values([{payrollRunEmployeeId:employee.id,lineType:"Earning",code:"REG",description:"Fictional earnings",amount:month===9?"100.00":"1000.00"},{payrollRunEmployeeId:employee.id,lineType:"Deduction",code:"SSS",description:"Fictional current contribution",amount:month===9?"200.00":"100.00"},...(month===9?[]:[{...recoveryLine({sourceId,employeeId:person.id,periodCode:"Race source",amountCents:10000}),payrollRunEmployeeId:employee.id,amount:"100.00"}])]);
        await tx.insert(payrollRunEvents).values({payrollRunId:runId,actorUserId:actor.id,eventType:"Computed",notes:JSON.stringify({attendanceSourceInputRunId:await attendancePayrollSnapshot(tx,periodId)})});
        if(month!==9)candidates.push(runId);
      }
    });
    const race = await Promise.allSettled(candidates.map(id=>transitionPayrollRunStatus(id,"Posted",actorId,"Fictional concurrent recovery",db,{actorRole:"ADMIN"})));
    assert.equal(race.filter(result=>result.status==="fulfilled").length,1,"Only one simultaneous post can recover the balance");
    const rejected=race.find(result=>result.status==="rejected") as PromiseRejectedResult;
    assert.match(String(rejected.reason),/Shortfall balances changed/);
    assert.equal((await loadShortfallBalances([employeeId],"2097-01-01")).balances.length,0,"Race collects exactly once");
  } finally {
    if(fixturePeriods.length)await db.delete(payrollPeriods).where(inArray(payrollPeriods.id,fixturePeriods));
  }
  assert.deepEqual(await fingerprint(),before,"Concurrent fixture cleanup preserves all seven tables");
  console.log("PASS restored database: real transition functions, original shortfalls 587.03, partial/full recovery, zero work, omitted/stale drafts, idempotent posts, reversal accounting, two-connection posting race, seven table fingerprints unchanged");
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
