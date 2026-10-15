import type { ManagerAttendanceOverview } from "@/lib/manager/oversight-types";

export const fixtureEmployees = [
  { id: "11111111-1111-4111-8111-111111111111", employeeNo: "00991", firstName: "Sample", lastName: "Alvarez" },
  { id: "22222222-2222-4222-8222-222222222222", employeeNo: "00992", firstName: "Sample", lastName: "Bautista" },
];
export const fixtureLeaveTypes = [{ id: 1, code: "AWOL", name: "Absent without leave" }, { id: 2, code: "VL", name: "Vacation leave" }];
const period = { id: "33333333-3333-4333-8333-333333333333", code: "2026-10-A", startDate: "2026-10-01", endDate: "2026-10-15" };
export const fixtureOverview: ManagerAttendanceOverview = {
  departments: [{ id: 1, name: "Sample branch" }], departmentId: 1,
  periods: [period], period, asOfDate: "2026-10-13", today: "2026-10-14", generatedAt: "2026-10-14T02:00:00Z",
  freshness: { state: "observed", lastSourceSeenAt: "2026-10-13T10:05:00Z", message: "Delivery completeness is unverified. Missing attendance may still be awaiting delivery or matching." },
  scopeNotice: "Current employees in your assigned branch. Attendance review does not approve payroll or determine entitlement.",
  employees: fixtureEmployees.map((person, index) => ({ employeeId: person.id, employeeNo: person.employeeNo, name: `${person.firstName} ${person.lastName}`, actionDays: 1, days: [{
    date: "2026-10-13", phase: "recorded", scheduleIn: "08:00", scheduleOut: "17:00", scheduleSource: "Confirmed period schedule", scheduleConfigured: true, isRestDay: false,
    breaks: [{ fromTime: "12:00", toTime: "13:00", requiresPunches: false }],
    scheduledMinutes: 480, workedMinutes: 0, regularMinutes: 0, lateMinutes: 0, undertimeMinutes: 0, overtimeMinutes: 0,
    overtimeApprovalOnFile: false, approvedLeave: false, leaveCoverage: "none", reviewedNoWork: false, held: false, correctedAt: null, hasTimeOverride: false,
    findings: [{ code: index === 0 ? "punches" : "scheduled-no-attendance", label: index === 0 ? "Missing or conflicting punches" : "Scheduled, no attendance received", needsAction: true }], needsAction: true,
    punches: index === 0 ? [{ id: "fixture-punch", type: "IN", at: "2026-10-13T00:00:00Z", included: true, state: "effective" }] : [],
  }, {
    date: "2026-10-15", phase: "future", scheduleIn: "08:00", scheduleOut: "17:00", scheduleSource: "Weekly default", scheduleConfigured: true, isRestDay: false,
    breaks: [{ fromTime: "12:00", toTime: "13:00", requiresPunches: false }], scheduledMinutes: 480, workedMinutes: 0, regularMinutes: 0, lateMinutes: 0, undertimeMinutes: 0, overtimeMinutes: 0,
    overtimeApprovalOnFile: false, approvedLeave: false, leaveCoverage: "none", reviewedNoWork: false, held: false, correctedAt: null, hasTimeOverride: false, findings: [], needsAction: false, punches: [],
  }] })),
  counts: { employees: 2, actionDays: 2, actionEmployees: 2, scheduledNoAttendanceDays: 1, punchProblemDays: 1, scheduleProblemDays: 0, heldDays: 0, overtimeDays: 0 },
  issues: fixtureEmployees.map((person, index) => ({ employeeId: person.id, name: `${person.firstName} ${person.lastName}`, date: "2026-10-13", code: index === 0 ? "punches" : "scheduled-no-attendance", label: index === 0 ? "Missing or conflicting punches" : "Scheduled, no attendance received" })),
};
