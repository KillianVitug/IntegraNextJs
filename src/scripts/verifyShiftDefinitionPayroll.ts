import assert from "node:assert/strict";
import {parseAttendanceBuffer,summarizeEmployeeDay,groupLogsByEmployeeAndAttendanceDate,type ShiftWindow} from "@/lib/payroll/attendance";
import {applyAttendanceDtrComputedHold,computePolicyAttendancePay,getComputedAttendanceDtrStatus} from "@/lib/payroll/dtrOverrides";
import {computeOvertimeCompensation,resolveApprovedOvertimeMinutes,resolveDetectedOvertimeMinutes,findMatchingOvertimeRule} from "@/lib/payroll/overtime";
import {buildAttendanceSummaryComputations} from "@/lib/payroll/attendanceSync";
import {resolveEmployeeScheduleForDate,type ShiftAssignmentRecord} from "@/lib/payroll/scheduleResolver";
import type {ScheduleSnapshot} from "@/lib/scheduling/workspace-types";
import {calculateGeneratedDtrRows,buildAttendanceDtrTotals,applyAttendanceDtrMetricOverride,type AttendanceTransaction} from "@/lib/payroll/generatedDtrCalculation";
import {getTableName} from "drizzle-orm";
import type {attendanceDailySummaries} from "@/db/schema";

const day="2098-10-15",employeeId="00000000-0000-4000-8000-000000000001";
const shift:ShiftWindow={calculationPolicy:"eight_hour_day",punchPolicy:"split_gaps",checkInTime:"08:00",checkOutTime:"21:00",breakMinutes:270,hoursPerDay:8.5,regularBreakWindows:[{fromTime:"11:00",toTime:"15:30",deductMinutes:270,requiresPunches:true}]};
function summarize(punches:string[],window:ShiftWindow=shift){const logs=parseAttendanceBuffer(Buffer.from(`EmployeeNo,DateTime,Direction\n${punches.map((value,index)=>{const [time,direction]=value.split(" ");return `F1,${time.length>8?time:`${day} ${time}`},${direction??(index%2?"OUT":"IN")}`;}).join("\n")}`),"fictional.csv").logs;return summarizeEmployeeDay(day,logs,window);}
const full=summarize(["08:00","11:00","15:30","21:00"]);
assert.equal(full.workedMinutes,510);assert.equal(full.regularMinutes,480);assert.equal(full.overtimeMinutes,30);assert.equal(full.scheduledMinutes,480);assert.equal(full.calculationPolicy,"eight_hour_day");assert.equal(full.anomalyFlags.length,0);
assert.equal(resolveDetectedOvertimeMinutes({scheduleOvertimeMinutes:full.overtimeMinutes,effectiveWorkedMinutes:full.workedMinutes,calculationPolicy:full.calculationPolicy}),30);
assert.equal(resolveApprovedOvertimeMinutes({isApproved:false,computedMinutes:30}),0);
assert.equal(findMatchingOvertimeRule([{category:"REGULAR_DAY",minutesFrom:60,minutesTo:null,rateMultiplier:1.25}],"REGULAR_DAY",30),null,"Detection does not invent an eligible OT rule");
assert.equal(computeOvertimeCompensation({approvedMinutes:30,dailyRate:800,scheduledMinutes:510,fallbackHoursPerDay:8.5,rateMultiplier:1.25,calculationPolicy:"eight_hour_day"}).amount,62.5);
assert.equal(computeOvertimeCompensation({approvedMinutes:30,dailyRate:599.99,scheduledMinutes:510,fallbackHoursPerDay:8.5,rateMultiplier:1.25,calculationPolicy:"eight_hour_day"}).amount.toFixed(2),"46.87","Explicit policy retains exact-minute compensation until money presentation/storage");
const missing=summarize(["08:00","21:00"]);assert.equal(getComputedAttendanceDtrStatus(missing),"Hold");assert.equal(applyAttendanceDtrComputedHold(missing).regularMinutes,0);
const misplaced=summarize(["08:00","08:15","08:20","21:00"]);assert.equal(getComputedAttendanceDtrStatus(misplaced),"Hold","Four arbitrary captures cannot satisfy a split gap");
assert.equal(getComputedAttendanceDtrStatus(summarize(["08:00 IN","11:00 IN","15:30 OUT","21:00 OUT"])),"Hold","Explicit bad directions cannot be paired by position");
const early=summarize(["08:00","10:30","16:00","21:00"]);assert.equal(early.regularMinutes,450);assert.equal(early.undertimeMinutes,30);assert.equal(early.lateMinutes,30);assert.equal(early.overtimeMinutes,0);
const multiple:ShiftWindow={...shift,checkOutTime:"20:00",regularBreakWindows:[{fromTime:"11:00",toTime:"12:00",deductMinutes:60,requiresPunches:true},{fromTime:"15:00",toTime:"16:00",deductMinutes:60,requiresPunches:true}]};
assert.equal(getComputedAttendanceDtrStatus(summarize(["08:00","11:00","12:00","20:00"],multiple)),"Hold");
const returns=summarize(["08:00","10:45","12:10","14:40","16:15","20:00"],multiple);assert.equal(returns.lateMinutes,25);assert.equal(returns.undertimeMinutes,35);assert.equal(returns.workedMinutes,540);assert.equal(returns.regularMinutes,480);assert.equal(returns.overtimeMinutes,60);
const paid:ShiftWindow={calculationPolicy:"eight_hour_day",punchPolicy:"outer",checkInTime:"08:00",checkOutTime:"17:00",regularBreakWindows:[{fromTime:"12:00",toTime:"13:00",deductMinutes:30}]};
const unpaidLunch={...paid,regularBreakWindows:[{fromTime:"12:00",toTime:"13:00",deductMinutes:60}]};assert.equal(summarize(["08:00","11:00"],unpaidLunch).undertimeMinutes,300);assert.equal(summarize(["13:00","17:00"],unpaidLunch).lateMinutes,240);
assert.equal(summarize(["08:00","17:00"],paid).workedMinutes,510);
assert.equal(summarize(["08:00","12:00","13:00","17:00"],paid).workedMinutes,510,"Part-paid break is credited once when actually punched");
assert.equal(summarize(["08:00","12:00","13:30","17:00"],paid).workedMinutes,480,"Late return loses only actual work, not the paid allowance twice");
const shortPaid={...shift,regularBreakWindows:[...shift.regularBreakWindows!,{fromTime:"10:00",toTime:"10:15",deductMinutes:0,requiresPunches:false}]};
assert.equal(summarize(["08:00","11:00","15:30","21:00"],shortPaid).workedMinutes,510,"Ordinary paid breaks do not require additional punches");
const otBreak={...shift,overtimeBreakWindows:[{fromTime:"21:30",toTime:"22:00",deductMinutes:30}]};
assert.equal(summarize(["08:00","11:00","15:30","23:00"],otBreak).overtimeMinutes,120);
const scheduledOtBreak=summarize(["08:00","11:00","15:30","21:00"],{...shift,overtimeBreakWindows:[{fromTime:"20:30",toTime:"20:45",deductMinutes:15}]});assert.equal(scheduledOtBreak.overtimeMinutes,15);assert.equal(scheduledOtBreak.regularMinutes,480);assert.equal(scheduledOtBreak.workedMinutes,495);
const night:ShiftWindow={...shift,checkInTime:"20:00",checkOutTime:"09:00",regularBreakWindows:[{fromTime:"23:00",toTime:"03:30",deductMinutes:270,requiresPunches:true}]};
const nightResult=summarize([`${day}T20:00:00 IN`,`${day}T23:00:00 OUT`,"2098-10-16T03:30:00 IN","2098-10-16T09:00:00 OUT"],night);assert.equal(nightResult.workedMinutes,510);assert.equal(nightResult.overtimeMinutes,30);assert.equal(nightResult.nightMinutes,210);
const lateNight=summarize([`${day}T08:00:00 IN`,`${day}T11:00:00 OUT`,`${day}T15:30:00 IN`,"2098-10-16T01:00:00 OUT"]);assert.equal(lateNight.workedMinutes,750);assert.equal(lateNight.overtimeMinutes,270);assert.equal(lateNight.nightMinutes,180);assert.equal(lateNight.anomalyFlags.length,0);
const lateNightBreak=summarize([`${day}T08:00:00 IN`,`${day}T11:00:00 OUT`,`${day}T15:30:00 IN`,"2098-10-16T01:00:00 OUT"],{...shift,overtimeBreakWindows:[{fromTime:"00:00",toTime:"00:30",deductMinutes:30}]});assert.equal(lateNightBreak.overtimeMinutes,240);assert.equal(lateNightBreak.nightMinutes,150);
const legacy=summarize(["08:00","11:00","15:30","21:00"],{...shift,calculationPolicy:"legacy",punchPolicy:"legacy",requiresSplitPunches:true});assert.equal(legacy.regularMinutes,510);assert.equal(legacy.overtimeMinutes,0,"Legacy OT rounding remains unchanged");
const legacyDay={...legacy,scheduledMinutes:360,workedMinutes:360,regularMinutes:360,lateMinutes:0,undertimeMinutes:0};
const pay=computePolicyAttendancePay([full,early,legacyDay],800);assert.equal(pay.minutes,480+450+480);assert.equal(pay.amount.toFixed(2),"2616.67","Each day has its own normal-pay divisor; explicit definitions use 8 hours");
assert.equal(computePolicyAttendancePay([{...full,regularMinutes:479}],800).amount.toFixed(2),"798.33","Normal pay uses exact minutes before currency rounding");
const lateHour={...full,workedMinutes:420,regularMinutes:420,lateMinutes:60,overtimeMinutes:0};
assert.equal(computePolicyAttendancePay([lateHour,lateHour,lateHour],800).minutes,960,"Three accumulated late hours retain the additional five-hour penalty; actual lost work is not deducted twice");
assert.equal(computePolicyAttendancePay([lateHour,{...lateHour,calculationPolicy:"legacy"},lateHour],800).minutes,960,"Accumulated lateness includes both policies");

const snapshot:ScheduleSnapshot={kind:"shift",shiftTableId:1,shiftName:"Fictional",shiftCode:"NO-NAME-SEMANTICS",checkInTime:"08:00",checkOutTime:"21:00",breakMinutes:270,paidBreakMinutes:0,graceMinutes:0,hoursPerDay:8.5,isFlexible:false,calculationPolicy:"eight_hour_day",punchPolicy:"split_gaps",breaks:[{slotKey:"mid_break",label:"Gap",fromTime:"11:00",toTime:"15:30",deduct:true,deductHours:4,deductMinutes:30,sortOrder:1,requiresPunches:true}]};
const assignment:ShiftAssignmentRecord={id:1,employeeId,shiftTableId:1,shiftName:"Fictional",shiftCode:"F",shiftSchedule:null,effectiveFrom:day,effectiveTo:day,checkInTime:"08:00",checkOutTime:"21:00",breakMinutes:270,paidBreakMinutes:0,graceMinutes:0,restDay:null,hoursPerDay:"8.50",isFlexible:false,createdAt:new Date(0),updatedAt:new Date(0),confirmedSchedule:snapshot,scheduleDecisionId:"00000000-0000-4000-8000-000000000002"};
assert.equal(resolveEmployeeScheduleForDate({attendanceDate:day,assignments:[assignment],weeklyPatterns:[],legacyTimekeeping:null}).shiftWindow.punchPolicy,"split_gaps");
const logs=parseAttendanceBuffer(Buffer.from(`EmployeeNo,DateTime,Direction\nF1,${day} 08:00,IN\nF1,${day} 11:00,OUT\nF1,${day} 15:30,IN\nF1,${day} 21:00,OUT`),"fictional.csv").logs.map(log=>({...log,employeeId}));
const [saved]=buildAttendanceSummaryComputations({employees:[{id:employeeId,employeeNo:"F1",timekeeping:null}],logs,approvedLeaves:[],shiftAssignments:[assignment],weeklyPatterns:[],shiftTableBreaksByShiftTableId:new Map(),allowedAttendanceDateRange:{startDate:day,endDate:day}});assert.equal(saved.calculationPolicy,"eight_hour_day");assert.equal(saved.regularMinutes,480);assert.equal(saved.overtimeMinutes,30);
const definitionBreak={...snapshot.breaks[0],id:1,shiftTableId:1,requiresPunches:true,createdAt:new Date(0),updatedAt:new Date(0)};
const [uncaptured]=buildAttendanceSummaryComputations({employees:[{id:employeeId,employeeNo:"F1",timekeeping:null}],logs,approvedLeaves:[],shiftAssignments:[{...assignment,confirmedSchedule:null,scheduleDecisionId:null,calculationPolicy:"eight_hour_day",punchPolicy:"split_gaps"}],weeklyPatterns:[],shiftTableBreaksByShiftTableId:new Map([[1,[definitionBreak]]]),allowedAttendanceDateRange:{startDate:day,endDate:day}});assert.equal(uncaptured.regularMinutes,480);assert.equal(uncaptured.overtimeMinutes,30);assert.doesNotMatch(uncaptured.anomalyFlags??"",/INCOMPLETE/);
const midnightLogs=parseAttendanceBuffer(Buffer.from(`EmployeeNo,DateTime,Direction\nF1,${day} 08:00,IN\nF1,${day} 11:00,OUT\nF1,${day} 15:30,IN\nF1,2098-10-16 01:00,OUT`),"fictional.csv").logs.map(log=>({...log,employeeId}));
const [midnightSaved]=buildAttendanceSummaryComputations({employees:[{id:employeeId,employeeNo:"F1",timekeeping:null}],logs:[...midnightLogs].reverse(),approvedLeaves:[],shiftAssignments:[assignment],weeklyPatterns:[],shiftTableBreaksByShiftTableId:new Map(),allowedAttendanceDateRange:{startDate:day,endDate:day}});assert.equal(midnightSaved.workedMinutes,750);assert.equal(midnightSaved.overtimeMinutes,270,"Summary builder retains an explicit next-day OUT closing the preceding open IN");
assert.equal(groupLogsByEmployeeAndAttendanceDate([midnightLogs.at(-1)!],()=>shift).get(`${employeeId}|2098-10-16`)?.length,1,"An orphan next-day OUT is not reassigned without its actual preceding IN");
assert.equal(buildAttendanceDtrTotals([early]).workedMinutes,450,"DTR totals use actual normal minutes without a second late/undertime subtraction");
assert.equal(applyAttendanceDtrMetricOverride(full,{lateMinutes:null,undertimeMinutes:null,overtimeMinutes:0}).workedMinutes,510,"OT-only override must not rewrite attendance");

async function verifyGeneratedRows() {
  const accounts=[{id:1,accountCode:"REG",accountType:"Regular Hours",description:"Regular hours",month13thPay:true,nonTaxable:false},{id:2,accountCode:"OT",accountType:"Overtime",description:"Regular overtime",month13thPay:false,nonTaxable:false},{id:3,accountCode:"LATE",accountType:"Tardiness",description:"Tardiness",month13thPay:false,nonTaxable:false}];
  let approved=false;
  let periodOverrides:Record<string,unknown>[]=[];
  // Every query terminates in this in-memory fixture. No database, network or writes.
  const tx={select(){return {from(table:Parameters<typeof getTableName>[0]){const name=getTableName(table);const rows=name==="accountCode"?accounts:name==="overtime_rules"?[{category:"REGULAR_DAY",minutesFrom:1,minutesTo:null,rateMultiplier:"1.25"}]:name==="employee_daily_overtime_overrides"?[{employeeId,attendanceDate:day,isApproved:approved,manualMinutes:null,category:"REGULAR_DAY"}]:name==="employee_attendance_period_overrides"?periodOverrides:[];return {where(){return this;},orderBy(){return Promise.resolve(rows);},then(resolve:(value:unknown[])=>unknown){return Promise.resolve(rows).then(resolve);}};}};}} as unknown as AttendanceTransaction;
  const row={...full,id:"fictional-summary",employeeId,shiftAssignmentId:1,sourceBatchId:null,anomalyFlags:JSON.stringify(full.anomalyFlags),remarks:null,createdAt:new Date(0),updatedAt:new Date(0)} as typeof attendanceDailySummaries.$inferSelect;
  const input={tx,payrollPeriod:{id:"00000000-0000-4000-8000-000000000003",startDate:day,endDate:day},employeeIds:[employeeId],summaryRows:[row]};
  const unapproved=await calculateGeneratedDtrRows(input);
  assert.equal(unapproved.find(item=>item.dtrOverrideSource==="DTR_WORKED")?.quantityMinutes,480);
  assert.equal(unapproved.some(item=>item.dtrOverrideSource==="DTR_REGULAR_OVERTIME"),false,"Detected overtime alone cannot generate pay");
  approved=true;
  const approvedRows=await calculateGeneratedDtrRows(input);
  assert.equal(approvedRows.find(item=>item.dtrOverrideSource==="DTR_REGULAR_OVERTIME")?.quantityMinutes,30,"Approved30min survives into the rule-backed generated row");
  assert.equal(row.overtimeMinutes,30,"Read-only projection retains source detection");
  periodOverrides=[{employeeId,presentDays:"2",workedMinutes:null,lateMinutes:null,undertimeMinutes:null,overtimeMinutes:null}];
  assert.equal((await calculateGeneratedDtrRows(input)).find(item=>item.dtrOverrideSource==="DTR_REGULAR_OVERTIME")?.quantityMinutes,30,"A present-days note cannot replace daily approved OT with generic period pay");
  for(const field of ["workedMinutes","lateMinutes","undertimeMinutes","overtimeMinutes"]) {
    periodOverrides=[{employeeId,[field]:field==="workedMinutes"?480:0}];
    await assert.rejects(()=>calculateGeneratedDtrRows(input),/Clear whole-period time overrides/);
  }
  periodOverrides=[];
  const penaltyRows=await calculateGeneratedDtrRows({...input,summaryRows:[15,16,17].map(date=>({...row,...lateHour,anomalyFlags:"[]",attendanceDate:`2098-10-${date}`}))});
  assert.equal(penaltyRows.filter(item=>item.dtrOverrideSource==="DTR_WORKED").reduce((sum,item)=>sum+(item.quantityMinutes??0),0),960);
  assert.equal(penaltyRows.filter(item=>item.dtrOverrideSource==="DTR_TARDINESS").reduce((sum,item)=>sum+(item.quantityMinutes??0),0),480,"Generated quantity-only tardiness reports late180 plus the existing penalty300 exactly once");
  console.log("PASS explicit shift payroll: eight-hour normal pay, detected/approved OT separation and generated rows, every split gap, missing/misplaced punches, paid/partial breaks, early OUT/late returns, OT breaks, overnight, mixed policies and captured definitions");
}
void verifyGeneratedRows();
