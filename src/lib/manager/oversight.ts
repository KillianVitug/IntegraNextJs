import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { department, employeeAttendanceDayMetricOverrides, employeeAttendanceDayStatusOverrides, employeeDailyOvertimeOverrides, employeeShiftAssignments, employeeWeeklyShiftPatterns, employees, employeesGeneralInfo, employeesLeaveRecords, employeesTimekeeping, leaveTypes, payrollPeriods, shiftTableBreaks } from "@/db/schema";
import { attendanceResolutions, attendanceSourceEvents, attendanceSourceMappings } from "@/db/attendanceSourceSchema";
import { workTreatments } from "@/db/attendanceWorkbenchSchema";
import { getManagerDepartmentIds, requireManager } from "@/lib/auth/server";
import { currentDepartmentMemberStatusCondition } from "@/lib/employmentStatus";
import { attendanceInputForDay, loadEffectiveAttendanceCorrections, loadEffectiveAttendanceInputSet, mapEffectiveAttendanceCorrections } from "@/lib/payroll/effectiveAttendanceInputs";
import { buildAttendancePeriodDetailRows } from "@/lib/payroll/attendanceSync";
import { resolveEmployeeScheduleForDate, isResolvedScheduleRestDay } from "@/lib/payroll/scheduleResolver";
import { resolveLeavePayStatus } from "@/lib/payroll/leave";
import { applyAttendanceDtrMetricOverride } from "@/lib/payroll/generatedDtrCalculation";
import { applyAttendanceDtrEffectiveStatus, normalizeAttendanceDtrAnomalyFlags } from "@/lib/payroll/dtrOverrides";
import { sourceDayOffset } from "@/lib/payroll/attendanceSourceClient";
import { adminDecision } from "@/lib/payroll/attendanceAdminDecision";
import { workDayRecords } from "@/lib/payroll/attendanceWorkbenchModel";
import { resolutionPeople } from "@/lib/payroll/attendanceResolution";
import type { ProvisionalDay } from "@/lib/payroll/provisionalTypes";
import type { ManagerAttendanceOverview, ManagerLeaveCoverage, ManagerOverviewQuery } from "./oversight-types";
import { projectManagerAttendanceDay, summarizeManagerAttendance } from "./oversight-model";

export class ManagerOverviewError extends Error {}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const querySchema = z.object({ departmentId: z.number().int().positive().optional(), periodId: z.string().uuid().optional(), asOfDate: date.optional(), employeeId: z.string().uuid().optional() });
const periodSelect = { id: payrollPeriods.id, code: sql<string>`coalesce(${payrollPeriods.code}, ${payrollPeriods.startDate}::text || ' to ' || ${payrollPeriods.endDate}::text)`, startDate: payrollPeriods.startDate, endDate: payrollPeriods.endDate };
const scopeNotice = "Current employees in your assigned branch. Historical team membership is not inferred. Attendance review does not approve payroll or determine entitlement.";

export async function getManagerAttendanceOverview(input: ManagerOverviewQuery = {}): Promise<ManagerAttendanceOverview> {
  const auth = await requireManager({ redirectTo: "/" });
  if (auth.role !== "MANAGER") throw new ManagerOverviewError("Manager access is required.");
  return readManagerAttendanceOverview({ accountId: auth.accountId, role: auth.role }, input);
}

/** Actor is supplied only by the authenticated server wrapper/API. The current
 * department assignment is re-read inside the same immutable database snapshot.
 * No financial calculator, salary relation, free-form notes or writes are used. */
export async function readManagerAttendanceOverview(actor: { accountId: string; role: string }, raw: ManagerOverviewQuery = {}, database: typeof db = db, now = new Date()): Promise<ManagerAttendanceOverview> {
  if (actor.role !== "MANAGER") throw new ManagerOverviewError("Manager access is required.");
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) throw new ManagerOverviewError("Choose a valid branch, period, employee and recorded date.");
  const input = parsed.data;
  const today = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const yesterday = sourceDayOffset(today, -1);
  if (input.asOfDate && input.asOfDate >= today) throw new ManagerOverviewError("Choose a completed Philippine workday before today.");
  return database.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout = '25000'`);
    const allowedIds = await getManagerDepartmentIds(actor.accountId, tx);
    if (input.departmentId && !allowedIds.includes(input.departmentId)) throw new ManagerOverviewError("This branch is not assigned to your account.");
    const departments = allowedIds.length ? await tx.select({ id: department.id, name: department.name }).from(department).where(inArray(department.id, allowedIds)).orderBy(asc(department.name)) : [];
    const employeeBranch = input.employeeId && !input.departmentId && allowedIds.length
      ? await tx.select({ departmentId: employeesGeneralInfo.departmentId }).from(employeesGeneralInfo).where(and(eq(employeesGeneralInfo.employeeId, input.employeeId), inArray(employeesGeneralInfo.departmentId, allowedIds), isNull(employeesGeneralInfo.deletedAt), currentDepartmentMemberStatusCondition())).limit(1) : [];
    if (input.employeeId && !input.departmentId && !employeeBranch.length) throw new ManagerOverviewError("The selected employee is unavailable in this branch.");
    const departmentId = input.departmentId ?? employeeBranch[0]?.departmentId ?? departments[0]?.id ?? null;
    // Catalogs include many future years. Select the actual requested/current
    // period independently of the bounded surrounding chooser.
    const [past, future, requested] = await Promise.all([
      tx.select(periodSelect).from(payrollPeriods).where(lte(payrollPeriods.startDate, today)).orderBy(desc(payrollPeriods.startDate)).limit(24),
      tx.select(periodSelect).from(payrollPeriods).where(gte(payrollPeriods.startDate, today)).orderBy(asc(payrollPeriods.startDate)).limit(6),
      input.periodId ? tx.select(periodSelect).from(payrollPeriods).where(eq(payrollPeriods.id, input.periodId)).limit(1) : Promise.resolve([]),
    ]);
    const period = (input.periodId ? requested[0] : past.find(row => row.endDate >= today) ?? past[0] ?? future[0]) ?? null;
    if (input.periodId && !period) throw new ManagerOverviewError("The selected period is unavailable. Choose another period.");
    const periods = [...new Map([...past, ...future, ...requested].map(row => [row.id, row])).values()].sort((a, b) => b.startDate.localeCompare(a.startDate));
    const asOfDate = input.asOfDate ?? (period && period.endDate < yesterday ? period.endDate : yesterday);
    const base: ManagerAttendanceOverview = { departments, departmentId, periods, period, asOfDate, today, generatedAt: now.toISOString(),
      freshness: { state: "unknown", lastSourceSeenAt: null, message: "Delivery completeness is unverified. Missing attendance may still be awaiting delivery or matching." },
      employees: [], ...summarizeManagerAttendance([]), scopeNotice };
    if (!departmentId || !period) {
      if (input.employeeId) throw new ManagerOverviewError("The selected employee is unavailable in this branch.");
      return base;
    }
    const periodDays = (Date.parse(period.endDate) - Date.parse(period.startDate)) / 86400000 + 1;
    if (periodDays < 1 || periodDays > 62) throw new ManagerOverviewError("Choose a period of no more than 62 days.");
    const roster = await tx.select({ id: employees.id, employeeNo: employees.employeeNo, firstName: employees.firstName, middleName: employees.middleName, lastName: employees.lastName,
      dateHired: employeesGeneralInfo.dateHired, separationDate: employeesGeneralInfo.separationDate,
    }).from(employees).innerJoin(employeesGeneralInfo, eq(employeesGeneralInfo.employeeId, employees.id)).where(and(
      eq(employeesGeneralInfo.departmentId, departmentId), isNull(employees.deletedAt), isNull(employeesGeneralInfo.deletedAt), currentDepartmentMemberStatusCondition(),
      input.employeeId ? eq(employees.id, input.employeeId) : undefined,
    )).orderBy(asc(employees.lastName), asc(employees.firstName), asc(employees.id));
    if (input.employeeId && !roster.length) throw new ManagerOverviewError("The selected employee is unavailable in this branch.");
    const ids = roster.map(row => row.id);
    if (!ids.length) return base;
    const scope = { employeeIds: ids, startDate: period.startDate, endDate: period.endDate };
    const [attendanceInputs, corrections, assignments, patterns, timekeeping, leaves, decisions, statusOverrides, metricOverrides, overtimeApprovals, noAttendanceDecisions, observed] = await Promise.all([
      loadEffectiveAttendanceInputSet(tx, { ...scope, neighborDays: "all" }), loadEffectiveAttendanceCorrections(tx, scope),
      tx.select().from(employeeShiftAssignments).where(and(inArray(employeeShiftAssignments.employeeId, ids), lte(employeeShiftAssignments.effectiveFrom, period.endDate), or(isNull(employeeShiftAssignments.effectiveTo), gte(employeeShiftAssignments.effectiveTo, sourceDayOffset(period.startDate, -1))))),
      tx.query.employeeWeeklyShiftPatterns.findMany({ where: and(inArray(employeeWeeklyShiftPatterns.employeeId, ids), lte(employeeWeeklyShiftPatterns.effectiveFrom, period.endDate), or(isNull(employeeWeeklyShiftPatterns.effectiveTo), gte(employeeWeeklyShiftPatterns.effectiveTo, sourceDayOffset(period.startDate, -1)))), with: { days: true } }),
      tx.select().from(employeesTimekeeping).where(inArray(employeesTimekeeping.employeeId, ids)),
      tx.query.employeesLeaveRecords.findMany({ where: and(inArray(employeesLeaveRecords.employeeId, ids), eq(employeesLeaveRecords.leaveStatus, "Approved"), isNull(employeesLeaveRecords.deletedAt), sql`coalesce(${employeesLeaveRecords.leaveStartDate}, ${employeesLeaveRecords.dateFiled}) <= ${period.endDate}`, sql`coalesce(${employeesLeaveRecords.leaveEndDate}, ${employeesLeaveRecords.leaveStartDate}, ${employeesLeaveRecords.dateFiled}) >= ${period.startDate}`), with: { leaveTypeLookup: true, dayDetails: true } }),
      tx.select({ employeeId: workTreatments.employeeId, day: workTreatments.day, payload: workTreatments.payload }).from(workTreatments).where(and(inArray(workTreatments.employeeId, ids), gte(workTreatments.day, period.startDate), lte(workTreatments.day, period.endDate), eq(workTreatments.active, true), sql`${workTreatments.payload}->>'kind' = 'AdminDecision'`)),
      tx.select({ employeeId: employeeAttendanceDayStatusOverrides.employeeId, attendanceDate: employeeAttendanceDayStatusOverrides.attendanceDate, status: employeeAttendanceDayStatusOverrides.status }).from(employeeAttendanceDayStatusOverrides).where(and(eq(employeeAttendanceDayStatusOverrides.payrollPeriodId, period.id), inArray(employeeAttendanceDayStatusOverrides.employeeId, ids))),
      tx.select({ employeeId: employeeAttendanceDayMetricOverrides.employeeId, attendanceDate: employeeAttendanceDayMetricOverrides.attendanceDate, lateMinutes: employeeAttendanceDayMetricOverrides.lateMinutes, undertimeMinutes: employeeAttendanceDayMetricOverrides.undertimeMinutes, overtimeMinutes: employeeAttendanceDayMetricOverrides.overtimeMinutes }).from(employeeAttendanceDayMetricOverrides).where(and(eq(employeeAttendanceDayMetricOverrides.payrollPeriodId, period.id), inArray(employeeAttendanceDayMetricOverrides.employeeId, ids))),
      tx.select({ employeeId: employeeDailyOvertimeOverrides.employeeId, attendanceDate: employeeDailyOvertimeOverrides.attendanceDate, isApproved: employeeDailyOvertimeOverrides.isApproved }).from(employeeDailyOvertimeOverrides).where(and(inArray(employeeDailyOvertimeOverrides.employeeId, ids), gte(employeeDailyOvertimeOverrides.attendanceDate, period.startDate), lte(employeeDailyOvertimeOverrides.attendanceDate, period.endDate))),
      tx.select({ employeeId: attendanceResolutions.employeeId }).from(attendanceResolutions).where(and(inArray(attendanceResolutions.employeeId, ids), eq(attendanceResolutions.payrollPeriodId, period.id), eq(attendanceResolutions.state, "Approved"), eq(attendanceResolutions.kind, "NoAttendance"))),
      tx.select({ at: attendanceSourceEvents.seenAt }).from(attendanceSourceEvents).innerJoin(attendanceSourceMappings, eq(attendanceSourceMappings.sourceEmployeeId, attendanceSourceEvents.sourceEmployeeId)).where(and(inArray(attendanceSourceMappings.employeeId, ids), gte(attendanceSourceEvents.capturedAt, new Date(`${period.startDate}T00:00:00+08:00`)), lte(attendanceSourceEvents.capturedAt, new Date(`${sourceDayOffset(period.endDate, 1)}T23:59:59+08:00`)))).orderBy(desc(attendanceSourceEvents.seenAt)).limit(1),
    ]);
    const noAttendanceSources = noAttendanceDecisions.length ? await resolutionPeople(tx, period, undefined, ids) : [];
    const verifiedNoAttendance = new Set(ids.filter(id => {
      const sources = noAttendanceSources.filter(person => person.employeeId === id && !person.contextOnly);
      return sources.length > 0 && sources.every(person => person.classification !== "TestOnly" && !person.issues.length && person.resolution?.kind === "NoAttendance" && person.resolution.state === "Approved");
    }));
    // Legacy records can lack a type FK. Read existing matching types from this
    // scoped transaction; the shared payroll fallback also seeds global defaults.
    const missingTypeCodes = [...new Set(leaves.filter(leave => !leave.leaveTypeLookup).map(leave => leave.leaveType.trim()).filter(Boolean))];
    const fallbackTypes = missingTypeCodes.length ? await tx.select().from(leaveTypes).where(inArray(leaveTypes.code, missingTypeCodes)) : [];
    const typesByCode = new Map(fallbackTypes.map(type => [type.code, type]));
    const shiftIds = [...new Set([...assignments.flatMap(row => row.shiftTableId ? [row.shiftTableId] : []), ...patterns.flatMap(row => row.days.flatMap(day => day.shiftTableId ? [day.shiftTableId] : []))])];
    const breaks = shiftIds.length ? await tx.select().from(shiftTableBreaks).where(inArray(shiftTableBreaks.shiftTableId, shiftIds)).orderBy(asc(shiftTableBreaks.shiftTableId), asc(shiftTableBreaks.sortOrder)) : [];
    const breaksByShift = new Map<number, typeof breaks>();
    for (const row of breaks) breaksByShift.set(row.shiftTableId, [...(breaksByShift.get(row.shiftTableId) ?? []), row]);
    const details = buildAttendancePeriodDetailRows({
      employees: roster.map(employee => ({ id: employee.id, employeeNo: employee.employeeNo, timekeeping: timekeeping.find(row => row.employeeId === employee.id) ?? null })),
      logs: attendanceInputs.logs.map(log => ({ ...log, rawLogId: log.id > 0 ? log.id : null, sourceLine: log.sourceLine ?? 0, rawText: log.rawText ?? "" })),
      approvedLeaves: leaves.map(leave => ({ employeeId: leave.employeeId, leaveStartDate: leave.leaveStartDate, leaveEndDate: leave.leaveEndDate, dateFiled: leave.dateFiled, isPaid: resolveLeavePayStatus(leave, typesByCode).isPaid })),
      shiftAssignments: assignments, weeklyPatterns: patterns, shiftTableBreaksByShiftTableId: breaksByShift, approvedCorrections: mapEffectiveAttendanceCorrections(corrections), startDate: period.startDate, endDate: period.endDate,
    });
    const resultEmployees = roster.map(employee => {
      const days = details.filter(day => day.employeeId === employee.id).map(day => {
        const schedule = resolveEmployeeScheduleForDate({ attendanceDate: day.attendanceDate, assignments: assignments.filter(row => row.employeeId === employee.id), weeklyPatterns: patterns.filter(row => row.employeeId === employee.id), legacyTimekeeping: timekeeping.find(row => row.employeeId === employee.id) ?? null });
        const rest = isResolvedScheduleRestDay(schedule), flags = normalizeAttendanceDtrAnomalyFlags(day.anomalyFlags);
        const manualStatus = statusOverrides.find(row => row.employeeId === employee.id && row.attendanceDate === day.attendanceDate)?.status;
        const attendance = attendanceInputForDay(attendanceInputs, employee.id, day.attendanceDate);
        const decision = adminDecision(decisions.find(row => row.employeeId === employee.id && row.day === day.attendanceDate)?.payload);
        const correctionDates = corrections.filter(row => row.employeeId === employee.id && row.attendanceDate === day.attendanceDate).flatMap(row => row.reviewedAt ? [row.reviewedAt.toISOString()] : []);
        const correctedAt = [...correctionDates, ...(decision?.approvedAt ? [decision.approvedAt] : [])].sort().at(-1) ?? null;
        const metricOverride = metricOverrides.find(row => row.employeeId === employee.id && row.attendanceDate === day.attendanceDate);
        const effective = applyAttendanceDtrEffectiveStatus(applyAttendanceDtrMetricOverride(day, metricOverride), manualStatus);
        // Build the same typed inputs used by the administrator's day findings;
        // the manager projection below never forwards arbitrary text or money.
        const canonical: ProvisionalDay = { attendance, payrollHold: manualStatus === "Hold", date: day.attendanceDate,
          scheduleIn: day.scheduledInTime, scheduleOut: day.scheduledOutTime,
          scheduleSource: schedule.overrideAssignment?.scheduleDecisionId ? "Confirmed period schedule" : schedule.source === "WEEKLY_PATTERN" ? "Weekly default" : schedule.source === "OVERRIDE" ? "Dated schedule" : "Employee default",
          isRestDay: rest, scheduledMinutes: day.scheduledMinutes, workedMinutes: day.workedMinutes, regularMinutes: day.regularMinutes,
          firstIn: null, lastOut: null, punches: [], warnings: [],
          status: manualStatus === "Hold" ? "Held time" : day.attendanceDate === today ? "In progress" : day.attendanceDate > today ? "Future" : !schedule.configured ? "Schedule missing" : day.paidLeaveMinutes > 0 ? "Paid leave" : flags.some(flag => /MISSING|INCOMPLETE|ODD|UNPAIRED|PARTIAL/.test(flag)) ? "Incomplete" : day.workedMinutes > 0 ? "Recorded" : rest ? "Rest day" : "No work recorded",
          review: { eligible: (!employee.dateHired || day.attendanceDate >= employee.dateHired) && (!employee.separationDate || day.attendanceDate <= employee.separationDate), scheduleConfigured: schedule.configured,
            approvedLeave: day.paidLeaveMinutes > 0 || day.unpaidLeaveMinutes > 0,
            reviewedNoWork: ["Absent", "No Logs", "Rest Day"].includes(manualStatus ?? "") || verifiedNoAttendance.has(employee.id) || Boolean(decision && !attendance.lateConflict && !workDayRecords(decision.records, day.attendanceDate, schedule.shiftWindow).some(record => record.status === "VALID" && !record.excluded)),
            correctedAt, lateMinutes: effective.lateMinutes, undertimeMinutes: effective.undertimeMinutes, overtimeMinutes: effective.overtimeMinutes,
            overtimeApproved: overtimeApprovals.some(row => row.employeeId === employee.id && row.attendanceDate === day.attendanceDate && row.isApproved), anomalyFlags: flags },
        };
        const dayLeaves = leaves.filter(leave => leave.employeeId === employee.id && (leave.leaveStartDate ?? leave.dateFiled) <= day.attendanceDate && (leave.leaveEndDate ?? leave.leaveStartDate ?? leave.dateFiled) >= day.attendanceDate);
        const leaveDays = dayLeaves.flatMap(leave => leave.dayDetails.filter(detail => detail.leaveDate === day.attendanceDate));
        // Keep partial coverage explicit instead of inheriting the payroll
        // builder's range-level leave exemption for the remaining workday.
        const partial = leaveDays.some(detail => detail.dayPart !== "FullDay" || Number(detail.quantity) > 0 && Number(detail.quantity) < 1)
          || dayLeaves.some(leave => !leave.dayDetails.length && (leave.leaveStartDate ?? leave.dateFiled) === (leave.leaveEndDate ?? leave.leaveStartDate ?? leave.dateFiled) && Number(leave.noOfDays) > 0 && Number(leave.noOfDays) < 1);
        const leaveCoverage: ManagerLeaveCoverage = !dayLeaves.length ? "none" : partial ? "partial-day" : leaveDays.some(detail => detail.dayPart === "FullDay" && Number(detail.quantity) >= 1) ? "full-day" : "unverified";
        const confirmedSchedule = schedule.overrideAssignment?.confirmedSchedule;
        const scheduledRestWork = confirmedSchedule?.kind === "shift" && confirmedSchedule.designatedRestDay === true;
        return projectManagerAttendanceDay(canonical, { today, asOfDate, now }, schedule.shiftWindow, Boolean(metricOverride && [metricOverride.lateMinutes, metricOverride.undertimeMinutes, metricOverride.overtimeMinutes].some(value => value != null)), leaveCoverage, scheduledRestWork);
      });
      return { employeeId: employee.id, employeeNo: employee.employeeNo, name: [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(" "), actionDays: days.filter(day => day.needsAction).length, days };
    });
    return { ...base, employees: resultEmployees, ...summarizeManagerAttendance(resultEmployees),
      freshness: observed[0] ? { state: "observed", lastSourceSeenAt: observed[0].at.toISOString(), message: "Last source observation for this selection. It does not confirm every phone has delivered or every identity is matched." } : base.freshness,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
