import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { workTreatments } from "@/db/attendanceWorkbenchSchema";
import { attendanceDailySummaries, employeeShiftAssignments, employeeWeeklyShiftPatterns, employeesLeaveRecords, payrollPeriods, payrollRuns, shiftTableBreaks } from "@/db/schema";
import { loadPayrollCalculation, type EmployeePayrollComputation } from "./engine";
import { loadEffectiveAttendanceCorrections, loadEffectiveAttendanceRawLogs, mapEffectiveAttendanceCorrections } from "./effectiveAttendanceInputs";
import { buildAttendancePeriodDetailRows, buildAttendanceSummaryComputations } from "./attendanceSync";
import { resolveEmployeeScheduleForDate, isResolvedScheduleRestDay } from "./scheduleResolver";
import { calculateGeneratedDtrRows, GENERATED_DTR_OVERRIDE_SOURCES } from "./generatedDtrCalculation";
import { buildLeaveTypeMapByCode, resolveLeavePayStatus } from "./leave";
import { earningMonth, monthRange, payrollGroup, runPayrollGroup } from "./payrollGroupModel";
import { loadEmployeeDepartmentMetadataByEmployeeId } from "./employeeDepartment";
import { isPayrollEligibleEmploymentStatus } from "@/lib/employmentStatus";
import { sourceDayOffset } from "./attendanceSourceClient";
import { normalizeAttendanceDtrAnomalyFlags } from "./dtrOverrides";
import { PayrollValidationError } from "./validation";
import { buildDeductibleRegularBreakWindows } from "@/lib/shifts";
import { buildManualPayrollBaselineSnapshotFromComputation, projectManualPayrollAttendanceLinesFromBaseline } from "./manualPayroll";
import type { ProvisionalAmounts, ProvisionalDay, ProvisionalEmployee, ProvisionalPayroll, ProvisionalPayrollQuery } from "./provisionalTypes";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const day = new Date(`${value}T00:00:00Z`); return Number.isFinite(day.getTime()) && day.toISOString().slice(0,10) === value; }, "Select a valid date.");
const querySchema = z.object({periodId:z.string().uuid(),group:z.enum(["Daily","Monthly"]),asOfDate:daySchema.optional(),departmentId:z.number().int().positive().optional(),employeeId:z.string().uuid().optional()});
type Summary = typeof attendanceDailySummaries.$inferSelect;
const emptyAmounts = ():ProvisionalAmounts => ({gross:0,deductions:0,net:0,shortfall:0});
const money = (value:number) => Math.round((value + Number.EPSILON)*100)/100;
function amounts(value:EmployeePayrollComputation):ProvisionalAmounts { return {gross:value.grossPay,deductions:value.totalDeductions,net:Math.max(0,value.netPay),shortfall:Math.max(0,-value.netPay)}; }
export function provisionalToday(now:Date = new Date()) { return new Date(now.getTime()+8*60*60*1000).toISOString().slice(0,10); }
function digest(value:unknown) { return createHash("sha256").update(JSON.stringify(value,(_key,v)=>v instanceof Map?[...v]:v instanceof Set?[...v]:v)).digest("hex"); }
function employeeName(employee:{firstName:string|null;middleName:string|null;lastName:string|null;suffix:string|null}) { return [employee.firstName,employee.middleName,employee.lastName,employee.suffix].filter(Boolean).join(" "); }

/** One immutable database snapshot, enforced READ ONLY by PostgreSQL. It neither
 * refreshes DTR nor seeds rules, creates a payroll run, collects a loan or writes
 * generated/manual earnings. Both scenarios use the normal payroll engine.
 */
export async function loadProvisionalPayroll(raw:ProvisionalPayrollQuery, database:typeof db = db):Promise<ProvisionalPayroll> {
  const parsed=querySchema.safeParse(raw);
  if(!parsed.success)throw new PayrollValidationError("Select a valid payroll period, group and cutoff date.");
  const input=parsed.data, today=provisionalToday(), asOfDate=input.asOfDate??sourceDayOffset(today,-1);
  if(asOfDate>=today)throw new PayrollValidationError("Choose a completed Philippine workday before today. Today's work remains in progress.");
  return database.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout = '25000'`);
    const [storedPeriod]=await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id,input.periodId));
    if(!storedPeriod)throw new PayrollValidationError("Payroll period not found.");
    if(storedPeriod.payrollTerms!=="Semi-Monthly")throw new PayrollValidationError("Provisional payroll currently supports the existing semi-monthly periods.");
    const period=input.group==="Monthly"?{...storedPeriod,...monthRange(storedPeriod)}:storedPeriod;
    const calculator=await loadPayrollCalculation(period,input.group,tx,{employeeId:input.employeeId,departmentId:input.departmentId,allowUnavailable:true});
    const visible=calculator.employeesForPayroll.filter(employee=>payrollGroup(employee.salary)===input.group && isPayrollEligibleEmploymentStatus(employee.generalInfo?.employmentStatus) &&
      (employee.generalInfo?.payrollTerms==="Semi-Monthly" || input.group==="Monthly"&&employee.generalInfo?.payrollTerms==="Monthly") &&
      (!employee.generalInfo?.separationDate || employee.generalInfo.separationDate>=period.startDate) && (input.departmentId==null||employee.generalInfo?.departmentId===input.departmentId));
    const employeeIds=visible.map(employee=>employee.id);
    const requiredCheckDates=[...new Set(calculator.holidays.flatMap(holiday=>[holiday.requireCheckDate1?holiday.checkDate1:null,holiday.requireCheckDate2?holiday.checkDate2:null]).filter((date):date is string=>Boolean(date)))];
    const outsideCheckDates=requiredCheckDates.filter(date=>date<period.startDate||date>period.endDate);
    const queryStart=[period.startDate,...outsideCheckDates].sort()[0],queryEnd=[period.endDate,...outsideCheckDates].sort().at(-1)!;
    const startDate=sourceDayOffset(queryStart,-1),scope={employeeIds,startDate:queryStart,endDate:queryEnd};
    const [logs,corrections,assignments,patterns,leaves,departments,runs,decisions] = await Promise.all([
      loadEffectiveAttendanceRawLogs(tx,{...scope,neighborDays:"all"}), loadEffectiveAttendanceCorrections(tx,scope),
      employeeIds.length?tx.select().from(employeeShiftAssignments).where(and(inArray(employeeShiftAssignments.employeeId,employeeIds),lte(employeeShiftAssignments.effectiveFrom,queryEnd),or(isNull(employeeShiftAssignments.effectiveTo),gte(employeeShiftAssignments.effectiveTo,startDate)))):[],
      employeeIds.length?tx.query.employeeWeeklyShiftPatterns.findMany({where:and(inArray(employeeWeeklyShiftPatterns.employeeId,employeeIds),lte(employeeWeeklyShiftPatterns.effectiveFrom,queryEnd),or(isNull(employeeWeeklyShiftPatterns.effectiveTo),gte(employeeWeeklyShiftPatterns.effectiveTo,startDate))),with:{days:true}}):[],
      employeeIds.length?tx.query.employeesLeaveRecords.findMany({where:and(inArray(employeesLeaveRecords.employeeId,employeeIds),eq(employeesLeaveRecords.leaveStatus,"Approved"),isNull(employeesLeaveRecords.deletedAt)),with:{leaveTypeLookup:true,dayDetails:true}}):[],
      loadEmployeeDepartmentMetadataByEmployeeId(employeeIds,tx),
      tx.select().from(payrollRuns).where(eq(payrollRuns.payrollPeriodId,period.id)),
      employeeIds.length?tx.select().from(workTreatments).where(and(inArray(workTreatments.employeeId,employeeIds),gte(workTreatments.day,queryStart),lte(workTreatments.day,queryEnd),eq(workTreatments.active,true),sql`${workTreatments.payload}->>'kind' = 'AdminDecision'`)):[],
    ]);
    const approvedDecisionDays=new Set(decisions.map(row=>`${row.employeeId}|${row.day}`));
    const leaveTypes=await buildLeaveTypeMapByCode(leaves.filter(leave=>!leave.leaveTypeLookup).map(leave=>leave.leaveType),tx);
    const shiftIds=[...new Set([...assignments.flatMap(row=>row.shiftTableId?[row.shiftTableId]:[]),...patterns.flatMap(row=>row.days.flatMap(day=>day.shiftTableId?[day.shiftTableId]:[]))])];
    const breaks=shiftIds.length?await tx.select().from(shiftTableBreaks).where(inArray(shiftTableBreaks.shiftTableId,shiftIds)).orderBy(asc(shiftTableBreaks.shiftTableId),asc(shiftTableBreaks.sortOrder)):[];
    const breaksByShift=new Map<number,typeof breaks>();for(const row of breaks)breaksByShift.set(row.shiftTableId,[...(breaksByShift.get(row.shiftTableId)??[]),row]);
    const context={employees:visible.map(employee=>({id:employee.id,employeeNo:employee.employeeNo,timekeeping:employee.timekeeping})),
      logs:logs.map(log=>({...log,rawLogId:log.id,sourceLine:log.sourceLine??0,rawText:log.rawText??""})),
      approvedLeaves:leaves.map(leave=>({employeeId:leave.employeeId,leaveStartDate:leave.leaveStartDate,leaveEndDate:leave.leaveEndDate,dateFiled:leave.dateFiled,isPaid:resolveLeavePayStatus(leave,leaveTypes).isPaid})),
      shiftAssignments:assignments,weeklyPatterns:patterns,shiftTableBreaksByShiftTableId:breaksByShift,approvedCorrections:mapEffectiveAttendanceCorrections(corrections)};
    const details=buildAttendancePeriodDetailRows({...context,startDate:period.startDate,endDate:period.endDate});
    const ranges=[{startDate:period.startDate,endDate:period.endDate},...outsideCheckDates.map(date=>({startDate:date,endDate:date}))];
    const built=ranges.flatMap(range=>buildAttendanceSummaryComputations({...context,allowedAttendanceDateRange:range}));
    const summariesAll=built.map((row,index)=>({...row,id:`provisional-${index}`,createdAt:new Date(0),updatedAt:new Date(0)} as Summary));
    const inPeriod=(row:Summary)=>row.attendanceDate>=period.startDate&&row.attendanceDate<=period.endDate;
    const summaries=summariesAll.filter(inPeriod);
    const employeeById=new Map(visible.map(employee=>[employee.id,employee]));
    const scheduleFor=(employeeId:string,date:string)=>resolveEmployeeScheduleForDate({attendanceDate:date,assignments:assignments.filter(row=>row.employeeId===employeeId),weeklyPatterns:patterns.filter(row=>row.employeeId===employeeId),legacyTimekeeping:employeeById.get(employeeId)?.timekeeping??null});
    const recordedAttendance=summaries.filter(row=>row.attendanceDate<=asOfDate);
    // Forecast is a separate hypothetical scenario. Actual records above never
    // receive invented punches, and all assumptions are local to this response.
    const forecastLogs:typeof context.logs=[];
    for (const row of summariesAll) {
      if(row.attendanceDate<today || row.attendanceDate<=asOfDate || approvedDecisionDays.has(`${row.employeeId}|${row.attendanceDate}`))continue;
      const schedule=scheduleFor(row.employeeId,row.attendanceDate);
      const confirmed=Boolean(schedule.overrideAssignment?.scheduleDecisionId && schedule.overrideAssignment.confirmedSchedule);
      const start=schedule.shiftWindow.checkInTime,end=schedule.shiftWindow.checkOutTime;
      if(!confirmed || !schedule.configured || isResolvedScheduleRestDay(schedule) || !start || !end || row.paidLeaveMinutes>0 || row.unpaidLeaveMinutes>0)continue;
      const employee=employeeById.get(row.employeeId)!;
      const split=[schedule.overrideAssignment?.shiftCode,schedule.overrideAssignment?.shiftName].some(value=>value?.toUpperCase().includes("SPLIT"));
      const gaps=split?buildDeductibleRegularBreakWindows(schedule.overrideAssignment?.confirmedSchedule?.breaks??[]):[];
      const punches:Array<["IN"|"OUT",string,string]>=[["IN",row.attendanceDate,start],...gaps.flatMap(gap=>[
        ["OUT",gap.fromTime<start?sourceDayOffset(row.attendanceDate,1):row.attendanceDate,gap.fromTime] as ["OUT",string,string],
        ["IN",gap.toTime<start?sourceDayOffset(row.attendanceDate,1):row.attendanceDate,gap.toTime] as ["IN",string,string],
      ]),["OUT",end<=start?sourceDayOffset(row.attendanceDate,1):row.attendanceDate,end]];
      for(const [direction,date,time] of punches) {
        forecastLogs.push({id:-forecastLogs.length-1,rawLogId:-forecastLogs.length-1,employeeId:row.employeeId,employeeNo:employee.employeeNo,batchId:"forecast",sourceFileName:"Hypothetical forecast",loggedAt:new Date(`${date}T${time}+08:00`),logDate:date,logTime:time,direction,sourceLine:0,rawText:"Hypothetical forecast only",deviceId:null,siteCode:null,normalizedHash:null});
      }
    }
    const forecastFuture=ranges.flatMap(range=>buildAttendanceSummaryComputations({...context,logs:forecastLogs,approvedCorrections:[],allowedAttendanceDateRange:range}));
    const futureByKey=new Map(forecastFuture.map(row=>[`${row.employeeId}|${row.attendanceDate}`,row]));
    const forecastAll=summariesAll.map(row=>row.attendanceDate<today||row.attendanceDate<=asOfDate||approvedDecisionDays.has(`${row.employeeId}|${row.attendanceDate}`)?row:{...row,...futureByKey.get(`${row.employeeId}|${row.attendanceDate}`)});
    const forecastAttendance=forecastAll.filter(inPeriod);
    const generatedInputs:unknown[]=[];
    async function scenario(attendance:Summary[], cutoff?:string) {
      const generated=await calculateGeneratedDtrRows({tx,payrollPeriod:period,employeeIds:calculator.eligibleEmployees.map(e=>e.id),summaryRows:attendance,checkDateSummaryRows:cutoff?summariesAll.filter(row=>row.attendanceDate<=cutoff):forecastAll,cutoff,onInputs:inputs=>generatedInputs.push(inputs)});
      const manualExceptions=calculator.payrollExceptionRows.filter(row=>!GENERATED_DTR_OVERRIDE_SOURCES.includes(row.dtrOverrideSource as typeof GENERATED_DTR_OVERRIDE_SOURCES[number]) && (!cutoff||row.attendanceDate<=cutoff));
      const exceptions=[...manualExceptions,...generated.map((row,index)=>({...row,id:`provisional-generated-${index}`,createdAt:new Date(0),updatedAt:new Date(0)} as typeof manualExceptions[number]))];
      const activeLeaves=cutoff?leaves.filter(leave=>(leave.leaveStartDate??leave.dateFiled)<=cutoff).map(leave=>({...leave,leaveEndDate:leave.leaveEndDate&&leave.leaveEndDate>cutoff?cutoff:leave.leaveEndDate,dayDetails:leave.dayDetails.filter(day=>day.leaveDate<=cutoff)})):leaves;
      return calculator.calculate({attendance,payrollExceptionRows:exceptions,leaves:activeLeaves,cutoff,
        projectManual:async(entry,computation)=>{
          // Fixed monthly overrides are administrator amounts; attendance does
          // not rewrite them. Daily attendance-backed lines share refresh rules.
          if(input.group==="Monthly")return entry;
          const latestBaseline=buildManualPayrollBaselineSnapshotFromComputation(computation,{accountCodeOptions:calculator.allAccountCodes.map(item=>({...item,code:item.accountCode}))});
          const projection=await projectManualPayrollAttendanceLinesFromBaseline({database:tx,payrollPeriodId:entry.payrollPeriodId,employeeId:entry.employeeId,latestBaseline,refreshableExceptionRowIds:[...calculator.payrollExceptionRows.filter(row=>row.employeeId===entry.employeeId&&row.dtrOverrideSource).map(row=>row.id),...exceptions.filter(row=>row.employeeId===entry.employeeId&&row.dtrOverrideSource).map(row=>row.id)]});
          if(!projection)return entry;
          return {...projection.entry,lines:projection.lines.map((line,index)=>({...line,id:`provisional-manual-${index}`,createdAt:new Date(0),updatedAt:new Date(0)} as typeof entry.lines[number]))};
        }});
    }
    const recorded=await scenario(recordedAttendance,asOfDate), forecast=asOfDate>=period.endDate?recorded:await scenario(forecastAttendance);
    const recordedMap=new Map(recorded.computations.map(row=>[row.employeeId,row])),forecastMap=new Map(forecast.computations.map(row=>[row.employeeId,row]));
    const rows=visible.map<ProvisionalEmployee>(employee=>{
      const payoutHalf=calculator.payouts.get(employee.id)??"B",scheduledThisHalf=input.group!=="Monthly"||payoutHalf===storedPeriod.cycle;
      const rec=recordedMap.get(employee.id),projected=forecastMap.get(employee.id),warnings:string[]=[];
      if(recorded.unavailable.has(employee.id))warnings.push(recorded.unavailable.get(employee.id)!);
      if(forecast.unavailable.has(employee.id)&&forecast.unavailable.get(employee.id)!==recorded.unavailable.get(employee.id))warnings.push(forecast.unavailable.get(employee.id)!);
      const days:ProvisionalDay[]=details.filter(day=>day.employeeId===employee.id && day.attendanceDate>=storedPeriod.startDate && day.attendanceDate<=storedPeriod.endDate).map(day=>{
        const schedule=scheduleFor(employee.id,day.attendanceDate),rest=isResolvedScheduleRestDay(schedule),flags=normalizeAttendanceDtrAnomalyFlags(day.anomalyFlags);
        const status:ProvisionalDay["status"]=day.attendanceDate===today?"In progress":day.attendanceDate>today?"Future":!schedule.configured?"Schedule missing":day.paidLeaveMinutes>0?"Paid leave":flags.some(flag=>/MISSING|INCOMPLETE|ODD|UNPAIRED|PARTIAL/.test(flag))?"Incomplete":day.workedMinutes>0?"Recorded":rest?"Rest day":"No work recorded";
        return {date:day.attendanceDate,scheduleIn:day.scheduledInTime,scheduleOut:day.scheduledOutTime,scheduleSource:schedule.overrideAssignment?.scheduleDecisionId?"Confirmed period schedule":schedule.source==="WEEKLY_PATTERN"?"Weekly default":schedule.source==="OVERRIDE"?"Dated schedule":"Employee default",isRestDay:rest,scheduledMinutes:day.scheduledMinutes,workedMinutes:day.workedMinutes,regularMinutes:day.regularMinutes,firstIn:day.firstInAt?.toISOString().slice(0,19)??null,lastOut:day.lastOutAt?.toISOString().slice(0,19)??null,punches:day.rawPunches.map(value=>{const raw=logs.find(log=>log.employeeId===employee.id && log.loggedAt.getTime()===value.getTime());return raw?`${raw.logDate} ${raw.logTime.length===5?raw.logTime+":00":raw.logTime} · ${raw.direction}`:`${value.toISOString().slice(0,19).replace("T"," ")} · Punch`;}),status,warnings:[...flags.filter(flag=>flag!=="NO_LOGS"),...(day.attendanceDate>=today&&approvedDecisionDays.has(`${employee.id}|${day.attendanceDate}`)?["Approved attendance decision retained; no additional work assumed in the forecast."]:[]),...(day.attendanceDate>asOfDate&&day.attendanceDate<today?["After the selected cutoff; included only in the forecast."]:[])]};
      });
      const unconfirmedFuture=days.filter(day=>day.date>=today&&!day.isRestDay&&day.scheduleSource!=="Confirmed period schedule");
      if(input.group==="Daily"&&unconfirmedFuture.length)warnings.push(`${unconfirmedFuture.length} future day(s) lack confirmed period schedules and are excluded from the forecast.`);
      if(calculator.attendancePeriodOverrideRows.some(row=>row.employeeId===employee.id))warnings.push("An approved whole-period attendance quantity override is included; it is not a daily accrual.");
      if(calculator.manualPayrollEntryRows.some(row=>row.employeeId===employee.id))warnings.push("Includes the administrator's saved manual payroll amounts.");
      const department=departments.get(employee.id),paid=calculator.priorPaid.employees.filter(row=>row.employeeId===employee.id);
      if(input.group==="Monthly" && rec?.grossPay===0 && paid.length)warnings.push("Monthly entitlement is covered by posted pay; there is no additional salary payable. Missing attendance did not reduce the salary.");
      if(input.group==="Monthly")for(const note of [rec?.breakdownNotes,projected?.breakdownNotes]){const creditNote=note?.match(/Posted amounts credited:[^\n|]+/g);for(const value of creditNote??[])if(!warnings.includes(value))warnings.push(value);}
      return {employeeId:employee.id,employeeNo:employee.employeeNo,name:employeeName(employee),departmentId:department?.departmentId??null,departmentName:department?.departmentName??null,payoutHalf,scheduledThisHalf,
        status:!scheduledThisHalf?"Not scheduled this half":!rec||!projected||warnings.some(w=>w===recorded.unavailable.get(employee.id)||w===forecast.unavailable.get(employee.id))?"Unavailable":input.group==="Daily"&&rec.grossPay===0?"No work — ₱0":"Available",
        recorded:!scheduledThisHalf?emptyAmounts():rec&&!recorded.unavailable.has(employee.id)?amounts(rec):null,forecast:!scheduledThisHalf?emptyAmounts():projected&&!forecast.unavailable.has(employee.id)?amounts(projected):null,
        recordedLines:rec?.lines??[],forecastLines:projected?.lines??[],postedCredits:input.group==="Monthly"?money(paid.reduce((total,row)=>total+Number(row.grossPay),0)):0,
        futureScheduledMinutes:forecastAttendance.filter(row=>row.employeeId===employee.id&&row.attendanceDate>=today).reduce((total,row)=>total+row.regularMinutes,0),warnings,days};
    }).sort((a,b)=>a.name.localeCompare(b.name));
    const sum=(field:"recorded"|"forecast")=>rows.reduce((total,row)=>{const value=row[field];if(value)for(const key of Object.keys(total) as Array<keyof ProvisionalAmounts>)total[key]=money(total[key]+value[key]);return total;},emptyAmounts());
    const postedRun=runs.find(run=>run.status==="Posted"&&[input.group,"Legacy"].includes(runPayrollGroup(run.inputSnapshot)));
    const inputRevision=digest({period,input,asOfDate,generatedInputs,calculationInputs:calculator.inputRevisionData,logs,corrections,decisions,assignments,patterns,breaks,leaves,departments,employees:visible,salaries:calculator.resolvedSalaryByEmployeeId,manual:calculator.manualPayrollEntryRows,exceptions:calculator.payrollExceptionRows,periodOverrides:calculator.attendancePeriodOverrideRows,statusOverrides:calculator.attendanceDayStatusOverrideRows,typeOverrides:calculator.attendanceDayTypeOverrideRows,rules:calculator.statutoryRules,accountCodes:calculator.allAccountCodes,holidays:calculator.holidays,recorded:recorded.computations,forecast:forecast.computations,paid:calculator.priorPaid.digest,shortfalls:recorded.shortfallLedger.digest,payouts:calculator.payouts});
    return {period:{id:storedPeriod.id,code:storedPeriod.code,startDate:storedPeriod.startDate,endDate:storedPeriod.endDate,earningMonth:earningMonth(period),status:storedPeriod.status},group:input.group,asOfDate,today,generatedAt:new Date().toISOString(),inputRevision,
      forecastAssumption:"Forecast uses known attendance for completed days and assumes today's and future confirmed working shifts are completed as scheduled. Missed past shifts remain no work. Approved attendance decisions remain unchanged. Hypothetical punches exist only in memory; no attendance records are created. Saved earnings, deductions and prior-payment credits follow the normal payroll rules.",rows,
      totals:{recorded:sum("recorded"),forecast:sum("forecast"),available:rows.filter(row=>row.status==="Available"||row.status==="No work — ₱0").length,unavailable:rows.filter(row=>row.status==="Unavailable").length,notScheduled:rows.filter(row=>!row.scheduledThisHalf).length},
      postedRun:postedRun?{id:postedRun.id,status:postedRun.status}:null,warnings:postedRun?["This group is posted. These current-input estimates do not change posted payroll or create an adjustment."]:[]};
  },{isolationLevel:"repeatable read",accessMode:"read only"});
}
