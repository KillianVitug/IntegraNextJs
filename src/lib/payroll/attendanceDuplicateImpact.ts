import "server-only";
import { isPayrollEligibleEmploymentStatus } from "@/lib/employmentStatus";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import { employeesGeneralInfo, employeesTimekeeping, employeeShiftAssignments, employeeWeeklyShiftPatterns, employeeWeeklyShiftPatternDays, shiftTableBreaks, attendanceDtrCorrections, employeeAttendancePeriodOverrides, employeeAttendanceDayStatusOverrides, employeeAttendanceDayMetricOverrides, employeesLeaveRecords } from "@/db/schema";
import { buildAttendanceSummaryComputations } from "./attendanceSync";
import { manilaWallTime, type SourcePunch } from "./attendanceSourceClient";
import type { DuplicateCandidate } from "./attendanceDuplicateModel";

/** Compare every possible retained capture under the actual employee schedule.
 * Unknown/manual treatment is review-only; the detector never assumes zero pay impact. */
export async function duplicateImpactSafe(tx: DbClient, periodId: string, employeeId: string, employeeNo: string, records: SourcePunch[], candidate: DuplicateCandidate, start: string, end: string) {
  const [general]=await tx.select().from(employeesGeneralInfo).where(eq(employeesGeneralInfo.employeeId,employeeId));
  if(!general?.employmentStatus || !isPayrollEligibleEmploymentStatus(general.employmentStatus) || general.separationDate && general.separationDate<=end)return false;
  for(const table of [attendanceDtrCorrections,employeeAttendancePeriodOverrides,employeeAttendanceDayStatusOverrides,employeeAttendanceDayMetricOverrides]) {
    if((await tx.select({id:table.id}).from(table).where(and(eq(table.employeeId,employeeId),eq(table.payrollPeriodId,periodId))).limit(1)).length)return false;
  }
  // Leave treatment is intentionally reviewed rather than inferred during auto-void.
  if((await tx.select({id:employeesLeaveRecords.id}).from(employeesLeaveRecords).where(and(eq(employeesLeaveRecords.employeeId,employeeId),eq(employeesLeaveRecords.leaveStatus,"Approved"),sql`coalesce(${employeesLeaveRecords.leaveStartDate},${employeesLeaveRecords.dateFiled}::date)<=${end}::date AND coalesce(${employeesLeaveRecords.leaveEndDate},${employeesLeaveRecords.leaveStartDate},${employeesLeaveRecords.dateFiled}::date)>=${start}::date`)).limit(1)).length)return false;
  const [timekeeping]=await tx.select().from(employeesTimekeeping).where(eq(employeesTimekeeping.employeeId,employeeId));
  const assignments=(await tx.select().from(employeeShiftAssignments).where(and(eq(employeeShiftAssignments.employeeId,employeeId),lte(employeeShiftAssignments.effectiveFrom,end)))).filter(r=>!r.effectiveTo||r.effectiveTo>=start);
  if(assignments.some(r=>r.isFlexible))return false;
  const patterns=(await tx.select().from(employeeWeeklyShiftPatterns).where(and(eq(employeeWeeklyShiftPatterns.employeeId,employeeId),lte(employeeWeeklyShiftPatterns.effectiveFrom,end)))).filter(r=>!r.effectiveTo||r.effectiveTo>=start);
  const days=patterns.length?await tx.select().from(employeeWeeklyShiftPatternDays).where(inArray(employeeWeeklyShiftPatternDays.patternId,patterns.map(p=>p.id))):[];
  const weeklyPatterns=patterns.map(p=>({...p,days:days.filter(d=>d.patternId===p.id)}));
  if(!timekeeping&&!assignments.length&&!weeklyPatterns.length)return false;
  const shiftIds=[...new Set([...assignments.map(p=>p.shiftTableId),...days.map(p=>p.shiftTableId)].filter((x):x is number=>x!=null))];
  const breaks=shiftIds.length?await tx.select().from(shiftTableBreaks).where(inArray(shiftTableBreaks.shiftTableId,shiftIds)):[];
  const breakMap=new Map(shiftIds.map(id=>[id,breaks.filter(b=>b.shiftTableId===id)]));
  const burst=[candidate.kept,...candidate.removed],ids=new Set(burst.map(p=>p.eventId));
  const variants=burst.map(keep=>{
    const logs=records.filter(p=>p.status==="VALID"&&(!ids.has(p.eventId)||p.eventId===keep.eventId)).map((p,i)=>{
      const wall=manilaWallTime(p.capturedAt);return {employeeNo,employeeId,loggedAt:new Date(p.capturedAt),logDate:wall.date,logTime:wall.time,direction:p.type,sourceLine:i,rawText:"source duplicate comparison"};
    });
    return buildAttendanceSummaryComputations({employees:[{id:employeeId,employeeNo,timekeeping:timekeeping??null}],logs,approvedLeaves:[],shiftAssignments:assignments,weeklyPatterns,shiftTableBreaksByShiftTableId:breakMap,allowedAttendanceDateRange:{startDate:start,endDate:end}}).map(r=>({day:r.attendanceDate,scheduled:r.scheduledMinutes,worked:r.workedMinutes,regular:r.regularMinutes,late:r.lateMinutes,under:r.undertimeMinutes,over:r.overtimeMinutes,night:r.nightMinutes,absent:r.absentMinutes,flags:r.anomalyFlags}));
  });
  return variants.length>1&&variants[0].length>0&&variants.every(v=>JSON.stringify(v)===JSON.stringify(variants[0]));
}
