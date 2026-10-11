import type { ProvisionalDay, ProvisionalEmployee } from "@/lib/payroll/provisionalTypes";
export const reviewFixtureScope = { asOfDate: "2026-10-09", today: "2026-10-11" };
export function reviewFixtureDay(patch: Partial<ProvisionalDay> = {}): ProvisionalDay {
  return { date: "2026-10-02", scheduleIn: "08:00", scheduleOut: "17:00", scheduleSource: "Confirmed period schedule", isRestDay: false, scheduledMinutes: 480, workedMinutes: 0, regularMinutes: 0, firstIn: null, lastOut: null, punches: [], status: "No work recorded", warnings: [], attendance: { punches: [], issues: [], missingDirection: null, complete: false, canConfirmExisting: false }, review: { eligible: true, scheduleConfigured: true, approvedLeave: false, reviewedNoWork: false, correctedAt: null, lateMinutes: 0, undertimeMinutes: 0, overtimeMinutes: 0, overtimeApproved: false, anomalyFlags: [] }, ...patch };
}
export function reviewFixtureEmployee(employeeId: string, days: ProvisionalDay[], patch: Partial<ProvisionalEmployee> = {}): ProvisionalEmployee {
  return { employeeId, employeeNo: `TEST-${employeeId}`, name: `Fictional Employee ${employeeId}`, departmentId: 1, departmentName: "Fictional Warehouse", payoutHalf: "A", scheduledThisHalf: true, status: "Available", recorded: { gross: 1200, deductions: 100, net: 1100, shortfall: 0 }, forecast: { gross: 1800, deductions: 100, net: 1700, shortfall: 0 }, recordedLines: [], forecastLines: [], postedCredits: 0, futureScheduledMinutes: 480, warnings: [], days, ...patch };
}
const base = reviewFixtureDay();
export const reviewFixtureRows: ProvisionalEmployee[] = [
  reviewFixtureEmployee("A", [base, reviewFixtureDay({ date: "2026-10-03", status: "Incomplete", punches: ["IN 08:00"], attendance: { punches: [{ id: "pending-a", at: "2026-10-03T00:00:00Z", type: "IN", included: true, reason: null }], issues: ["Missing OUT"], missingDirection: "OUT", complete: false, canConfirmExisting: false } }), reviewFixtureDay({ date: "2026-10-04" })]),
  reviewFixtureEmployee("B", [reviewFixtureDay({ date: "2026-10-06", payrollHold: true, status: "Held time", attendance: { punches: [], issues: ["Device clock needs verification"], missingDirection: null, complete: false, canConfirmExisting: false, lateConflict: true } })]),
  reviewFixtureEmployee("C", [reviewFixtureDay({ date: "2026-10-07", status: "Recorded", workedMinutes: 480, regularMinutes: 480, attendance: { punches: [{ id: "corrected-in", at: "2026-10-07T00:00:00Z", type: "IN", included: true, reason: null }, { id: "corrected-out", at: "2026-10-07T09:00:00Z", type: "OUT", included: true, reason: null }], issues: [], missingDirection: null, complete: true, canConfirmExisting: false }, review: { ...base.review!, correctedAt: "2026-10-11T01:01:00Z", lateMinutes: 15, overtimeMinutes: 30, overtimeApproved: true } })]),
  reviewFixtureEmployee("D", [], { recorded: { gross: 0, deductions: 0, net: 0, shortfall: 0 }, status: "No work — ₱0" }),
  reviewFixtureEmployee("E", [], { recorded: null, forecast: null, status: "Unavailable" }),
];
