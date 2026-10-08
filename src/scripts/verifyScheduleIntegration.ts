import assert from "node:assert/strict";
import { parseAttendanceBuffer } from "@/lib/payroll/attendance";
import { buildAttendanceSummaryComputations } from "@/lib/payroll/attendanceSync";
import { resolveEmployeeScheduleForDate, isResolvedScheduleRestDay, scheduleVersionRecord, type ShiftAssignmentRecord, type WeeklyShiftPatternRecord } from "@/lib/payroll/scheduleResolver";

const employeeId = "00000000-0000-4000-8000-000000000001";
const day = "2026-10-15";
const base: ShiftAssignmentRecord = {
  id: 1, employeeId, shiftTableId: 1, shiftName: "Reviewed overnight", shiftCode: "NIGHT",
  shiftSchedule: null, effectiveFrom: day, effectiveTo: day, checkInTime: "22:00", checkOutTime: "06:00",
  breakMinutes: 60, paidBreakMinutes: 0, graceMinutes: 0, restDay: null, hoursPerDay: "7.00", isFlexible: false,
  createdAt: new Date(0), updatedAt: new Date(0),
};
const snapshot = {kind: "shift" as const, shiftTableId: 1, shiftName: base.shiftName, shiftCode: base.shiftCode,
  checkInTime: base.checkInTime, checkOutTime: base.checkOutTime, breakMinutes: 60, paidBreakMinutes: 0,
  graceMinutes: 0, hoursPerDay: 7, isFlexible: false, breaks: []};
const confirmed = {...base, scheduleDecisionId: "00000000-0000-4000-8000-000000000002", confirmedSchedule: snapshot};
const resolve = (assignments: ShiftAssignmentRecord[], weeklyPatterns: WeeklyShiftPatternRecord[] = [], attendanceDate = day) => resolveEmployeeScheduleForDate({attendanceDate, assignments, weeklyPatterns, legacyTimekeeping: null});
const result = resolve([{...base, id: 99, checkInTime: "08:00"}, confirmed]);
assert.equal(result.overrideAssignment?.id, 1, "Confirmed revision wins over a later unreviewed legacy assignment");
assert.equal(result.shiftWindow.checkInTime, "22:00");
assert.equal(result.shiftWindow.checkOutTime, "06:00", "Overnight end remains on its shift rather than being clipped to period midnight");
assert.equal(resolve([confirmed], [], "2026-10-16").source, "LEGACY", "Next-period day does not inherit previous work-date ownership");
const missing = resolve([{...confirmed, checkInTime: "00:00", checkOutTime: "00:00", hoursPerDay: "0.00", confirmedSchedule: {...snapshot, kind: "unconfigured", hoursPerDay: 0, checkInTime: null, checkOutTime: null}}]);
assert.equal(missing.configured, false);
assert.equal(isResolvedScheduleRestDay(missing), false, "Unknown is not an explicit rest day");
assert.equal(missing.hoursPerDay, 0);
const rest = resolve([{...confirmed, restDay: "Thursday", hoursPerDay: "0.00", confirmedSchedule: {...snapshot, kind: "rest", hoursPerDay: 0}}]);
assert.equal(rest.configured, true);
assert.equal(isResolvedScheduleRestDay(rest), true);
assert.equal(resolve([]).configured, false, "No employee profile is not a configured eight-hour schedule");
const flexible = resolve([{...confirmed, checkInTime: "00:00", checkOutTime: "00:00", confirmedSchedule: {...snapshot, isFlexible: true, checkInTime: null, checkOutTime: null}}]);
assert.equal(flexible.shiftWindow.checkInTime, null, "Storage placeholders must not turn flexible schedules into midnight shifts");
assert.deepEqual(scheduleVersionRecord({...base, confirmedSchedule: null, scheduleDecisionId: null}), base, "Additive migration does not stale existing attendance drafts");
assert.deepEqual(scheduleVersionRecord(confirmed), confirmed, "Real reviewed revisions remain part of the version");
assert.deepEqual(scheduleVersionRecord({id: 1, scheduleState: null}), {id: 1});
const regularSnapshot = {...snapshot, checkInTime: "08:00:00", checkOutTime: "17:00:00", hoursPerDay: 8,
  breaks: [{slotKey: "mid_break" as const, label: "Lunch", fromTime: "12:00:00", toTime: "13:00:00", deduct: true, deductHours: 1, deductMinutes: 0, sortOrder: 0}]};
const frozen = {...confirmed, checkInTime: "08:00:00", checkOutTime: "17:00:00", hoursPerDay: "8.00", confirmedSchedule: regularSnapshot};
const logs = parseAttendanceBuffer(Buffer.from(`EmployeeNo,DateTime,Direction\nF1,${day} 08:00:00,IN\nF1,${day} 17:00:00,OUT`), "fixture.csv").logs.map(row => ({...row, employeeId}));
const summaryInput = {employees: [{id: employeeId, employeeNo: "F1", timekeeping: null}], logs, approvedLeaves: [], shiftAssignments: [frozen], weeklyPatterns: [], shiftTableBreaksByShiftTableId: new Map(), allowedAttendanceDateRange: {startDate: day, endDate: day}};
const summary = buildAttendanceSummaryComputations(summaryInput)[0];
assert.equal(summary.regularMinutes, 480, "Confirmed day retains its reviewed one-hour break without reading live template breaks");
const changedTemplateBreak = {...regularSnapshot.breaks[0], id: 1, shiftTableId: 1, toTime: "14:00:00", deductHours: 2, createdAt: new Date(0), updatedAt: new Date(0)};
assert.equal(buildAttendanceSummaryComputations({...summaryInput, shiftTableBreaksByShiftTableId: new Map([[1, [changedTemplateBreak]]])})[0].regularMinutes, 480, "Editing live break times does not alter a confirmed period's payable calculation");
const unknownSummary = buildAttendanceSummaryComputations({...summaryInput, shiftAssignments: [{...frozen, confirmedSchedule: {...regularSnapshot, kind: "unconfigured" as const, checkInTime: null, checkOutTime: null, hoursPerDay: 0, breaks: []}, hoursPerDay: "0.00"}]})[0];
assert.equal(unknownSummary.regularMinutes, 0);
assert.match(unknownSummary.anomalyFlags ?? "", /SCHEDULE_MISSING/);
console.log("PASS schedule integration: reviewed precedence, overnight boundary, missing/rest distinction and migration version stability");
