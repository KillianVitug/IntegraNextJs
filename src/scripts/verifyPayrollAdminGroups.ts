import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { accountCode, employees, employeesSalary, payrollPeriods, payrollRuns, payrollRunEmployees, payrollRunLines } from "@/db/schema";
import { monthlyPayrollSettings } from "@/db/payrollGroupSchema";
import { computeEmployeePayroll, transitionPayrollRunStatus } from "@/lib/payroll/engine";
import { getActiveStatutoryRuleBundle } from "@/lib/payroll/statutory";
import { remainingMonthlyLines, monthRange } from "@/lib/payroll/payrollGroupModel";
import { monthlyPayouts, postedMonthPayments, employeePayrollRun, payrollInputPeriodScope } from "@/lib/payroll/payrollGroups";
import { and, eq, inArray, sql } from "drizzle-orm";

async function main(){
 assert.equal(new URL(process.env.DATABASE_URL!).hostname,"127.0.0.1","Restored LOCAL database only");
 type Args=Parameters<typeof computeEmployeePayroll>[0];
 const id=randomUUID(),periodId=randomUUID();
 const period={id:periodId,code:"2026-09-B",year:2026,month:9,cycle:"B",payrollTerms:"Semi-Monthly",startDate:"2026-09-01",endDate:"2026-09-30",adjustedPayDate:"2026-09-30",nominalPayDate:"2026-09-30",status:"Open"} as Args["period"];
 const salary={monthlyRate:"30000",dailyRate:"1153.8462",rateDivisor:"26",monthlyAllowance:"0",dailyAllowance:"0",cola:"0",ignoreDtrForMonthlyRate:false,ignoreContributionDeduction:false} as Args["resolvedSalary"]["salary"];
 const accounts=await db.select().from(accountCode),accountCodes=new Map(accounts.map(a=>[a.accountCode,a]));
 const base={employee:{id,employeeNo:"999999",firstName:"Fictional",lastName:"Acceptance",employeeType:"EMP",salary,timekeeping:null},resolvedSalary:{salary,adjustmentId:null,adjustmentMode:null,resolvedFrom:"Base"},period,monthlyOnce:true,holidays:new Set(),shiftAssignments:[],weeklyPatterns:[],attendance:[],attendanceStatusOverridesByDate:new Map(),attendanceDayTypeOverridesByDate:new Map(),calendarDayTypeByDate:new Map(),payrollExceptionRows:[],overtimeRuleRows:[],approvedLeaves:[],leaveTypesByCode:new Map(),recurringEntries:[],dueInstallments:[],accountCodes,customPayrollMap:new Map(),statutoryBundle:await getActiveStatutoryRuleBundle(period.adjustedPayDate),priorCycleTaxContext:new Map(),birYearToDateTaxContext:new Map([[id,{priorTaxableCompensation:0,priorTaxWithheld:0,priorDeMinimisByType:{},priorOtherBenefits:0}]])} as unknown as Args;
 const b=await computeEmployeePayroll(base),a=await computeEmployeePayroll({...base,period:{...period,cycle:"A"}});
 assert.equal(b.regularPay,30000);assert.equal(a.regularPay,30000);assert.equal(a.netPay,b.netPay,"Whole-month calculation is independent of payout half");
 assert.ok(b.totalDeductions>0,"Configured monthly contributions are applied");
 assert.ok(!b.lines.some(l=>["ABS","LATE","UT"].includes(l.code)&&l.amount>0),"Missing logs cannot deduct fixed salary");
 const loanIds=[randomUUID(),randomUUID()];
 const loans=loanIds.map((loanId,index)=>({id:loanId,payrollCode:`2026-09-${index?"B":"A"}`,scheduledAmount:"500",loan:{accountCodeId:null,loanReferenceNumber:"FIXTURE"}})) as Args["dueInstallments"];
 const withLoans=await computeEmployeePayroll({...base,dueInstallments:loans});
 assert.deepEqual(withLoans.lines.filter(l=>l.sourceTable==="loan_installments").map(l=>l.sourceId).sort(),loanIds.sort());
 assert.equal(withLoans.netPay,b.netPay-1000);
 const dailySalary={...salary,monthlyRate:"0",dailyRate:"600"} as NonNullable<Args["employee"]["salary"]>;
 const daily=await computeEmployeePayroll({...base,monthlyOnce:false,employee:{...base.employee,salary:dailySalary},resolvedSalary:{...base.resolvedSalary,salary:dailySalary},dueInstallments:loans});
 assert.equal(daily.grossPay,0);assert.equal(daily.netPay,0);assert.equal(daily.totalDeductions,0);assert.ok(!daily.lines.some(l=>l.sourceTable==="loan_installments"));
 const partial=await computeEmployeePayroll({...base,monthlyOnce:false,employee:{...base.employee,salary:dailySalary},resolvedSalary:{...base.resolvedSalary,salary:dailySalary},attendance:[{employeeId:id,attendanceDate:"2026-09-29",scheduledMinutes:480,workedMinutes:240,regularMinutes:240,lateMinutes:0,undertimeMinutes:0,overtimeMinutes:0,nightMinutes:0,paidLeaveMinutes:0,unpaidLeaveMinutes:0,absentMinutes:0,isRestDay:false,firstInAt:new Date("2026-09-29T08:00:00Z"),lastOutAt:new Date("2026-09-29T12:00:00Z"),anomalyFlags:"ODD_PUNCH_COUNT,MISSING_OUT,PARTIAL_VALID_WORK"} as Args["attendance"][number]]});
 assert.equal(partial.regularPay,300,"Only the four valid paired hours are paid");
 accountCodes.set("FIXTURE-INCOME",{...accounts[0],id:999999,accountCode:"FIXTURE-INCOME",accountType:"Other Income",nonTaxable:true});
 const earning=await computeEmployeePayroll({...base,monthlyOnce:false,employee:{...base.employee,salary:dailySalary},resolvedSalary:{...base.resolvedSalary,salary:dailySalary},recurringEntries:[{id:999999,status:"Active",accountCode:"FIXTURE-INCOME",amount:"700",description:"Approved manual earning",startDate:null,endDate:null} as Args["recurringEntries"][number]]});
 assert.equal(earning.grossPay,700,"Approved earnings survive absent attendance");
 const prior=b.lines.map(l=>({...l,amount:l.amount/2}));
 const credit=remainingMonthlyLines(b.lines,prior,15000);assert.equal(credit.lines.find(l=>l.code==="REG")?.amount,15000);assert.equal(credit.excess,0);
 const over=remainingMonthlyLines(b.lines,[{lineType:"Earning",code:"REG",amount:35000}],35000);assert.equal(over.lines.find(l=>l.code==="REG")?.amount,0);assert.equal(over.excess,5000);assert.ok(over.lines.every(l=>l.amount>=0));
 const noRepeatedLoan=remainingMonthlyLines(b.lines,[{lineType:"Deduction",code:"LOAN",amount:500,sourceTable:"loan_installments",sourceId:loanIds[0]}],0);assert.equal(noRepeatedLoan.excess,0,"Previously paid installments are not overpayments");
 const negative=[{lineType:"Earning",code:"APPROVED-ADJ",amount:-500}];
 assert.equal(remainingMonthlyLines(negative,[],0).lines[0].amount,-500,"Explicit approved negative adjustments survive");
 assert.equal(remainingMonthlyLines(negative,negative,0).lines[0].amount,0,"Previously posted negative adjustments are not repeated");
 assert.deepEqual(monthRange({year:2028,month:2}),{startDate:"2028-02-01",endDate:"2028-02-29"});
 console.log("PASS fixed monthly A/B, no attendance deductions, configured contributions, both loan identities, daily zero, approved earnings, partial credits and excess disclosure");
 // Roll back every synthetic database mutation. The restored backup remains intact.
 const rollback=new Error("ROLLBACK_FIXTURE");
 try{await db.transaction(async tx=>{
  await tx.insert(employees).values({id,employeeNo:"FIXTURE-"+id.slice(0,8),firstName:"Fictional",lastName:"Payroll"});
  await tx.insert(employeesSalary).values({employeeId:id,monthlyRate:"30000"});
  await tx.insert(payrollPeriods).values({...period,code:"FIXTURE-"+periodId.slice(0,8)});
  await tx.insert(monthlyPayrollSettings).values({employeeId:id,effectiveMonth:"2026-09-01",payoutHalf:"A",actor:"fixture"});
  assert.equal((await monthlyPayouts("2026-08",tx)).get(id)??"B","B");assert.equal((await monthlyPayouts("2026-09",tx)).get(id),"A");
  const runIds=[randomUUID(),randomUUID(),randomUUID()];
  for(const [index,group] of ["Legacy","Daily","Monthly"].entries())await tx.insert(payrollRuns).values({id:runIds[index],payrollPeriodId:periodId,runNumber:index+1,status:"Posted",runType:"Regular",inputSnapshot:group==="Legacy"?{}:{payrollGroup:group,earningMonth:"2026-09"}});
  assert.equal((await employeePayrollRun(periodId,id,tx))?.id,runIds[2],"Employee selects own group, not another group's latest run");
  const firstHalfId=randomUUID();await tx.insert(payrollPeriods).values({...period,id:firstHalfId,code:"FIXTURE-A-"+firstHalfId.slice(0,8),cycle:"A"});
  assert.deepEqual((await tx.select({id:payrollRuns.id}).from(payrollRuns).where(and(payrollInputPeriodScope(firstHalfId),inArray(payrollRuns.id,runIds)))).map(r=>r.id),[runIds[2]],"First-half monetary inputs affect the second-half monthly group, not unrelated daily/legacy runs");
  const [paidEmployee]=await tx.insert(payrollRunEmployees).values({payrollRunId:runIds[0],employeeId:id,employeeNoSnapshot:"FIXTURE",employeeNameSnapshot:"Fictional Payroll",regularPay:"15000",grossPay:"15000",taxablePay:"15000",nonTaxablePay:"0",totalDeductions:"1000",employeeContributions:"1000",employerContributions:"0",netPay:"14000"}).returning();
  await tx.insert(payrollRunLines).values({payrollRunEmployeeId:paidEmployee.id,lineType:"Earning",code:"REG",description:"Previously posted salary",amount:"15000"});
  const paid=await postedMonthPayments(period,[id],tx);assert.equal(paid.employees.length,1);assert.equal(Number(paid.employees[0].regularPay),15000);
  await tx.execute(sql`savepoint duplicate_post`);
  await assert.rejects(()=>tx.insert(payrollRuns).values({payrollPeriodId:periodId,runNumber:4,status:"Posted",runType:"Regular",inputSnapshot:{payrollGroup:"Monthly"}}),/duplicate|unique|constraint/i);
  await tx.execute(sql`rollback to savepoint duplicate_post`);
  const pending=randomUUID();await tx.insert(payrollRuns).values({id:pending,payrollPeriodId:periodId,runNumber:5,status:"Approved",runType:"Regular",inputSnapshot:{payrollGroup:"Monthly",postedPaymentDigest:"old"}});
  await tx.insert(payrollRunEmployees).values({payrollRunId:pending,employeeId:id,employeeNoSnapshot:"FIXTURE",employeeNameSnapshot:"Fictional Payroll"});
  // Inject the test transaction while retaining the real posting validator.
  const testDatabase={transaction:async(fn:(value:typeof tx)=>Promise<unknown>)=>fn(tx)} as unknown as typeof db;
  await assert.rejects(()=>transitionPayrollRunStatus(pending,"Posted","fixture",null,testDatabase),/Posted monthly payments changed/);
  throw rollback;
 });}catch(error){if(error!==rollback)throw error;}
 assert.equal((await db.select().from(employees).where(eq(employees.id,id))).length,0);
 console.log("PASS effective payout settings, legacy credit lookup, group selection, per-group posted uniqueness and concurrent-payment rejection; fixtures rolled back");
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
