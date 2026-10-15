import type { ProvisionalDay } from "@/lib/payroll/provisionalTypes";
import { getProvisionalDayReview } from "@/lib/payroll/provisionalReview";
import type { ManagerAttendanceDay, ManagerAttendanceOverview, ManagerFindingCode, ManagerLeaveCoverage, ManagerOverviewEmployee } from "./oversight-types";
import type { ShiftWindow } from "@/lib/payroll/attendance";

const labels: Record<ManagerFindingCode, string> = {
  hold: "Attendance held for administrator review",
  "new-evidence": "New evidence after an approved correction",
  punches: "Missing or conflicting punches; review the workday",
  schedule: "Schedule missing for recorded attendance",
  "rest-work": "Attendance recorded on a rest day",
  "scheduled-no-attendance": "Scheduled workday; no attendance received",
  late: "Recorded lateness or undertime",
  overtime: "Recorded overtime; administrator review may be needed",
  corrected: "Saved attendance correction",
  "partial-leave": "Partial-day leave — review remaining attendance",
};
const states = ["effective", "pending", "resolved", "voided", "excluded"] as const;
const minutes = (value: number | undefined) => Number.isFinite(value) && value! > 0 ? value! : 0;
const iso = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const clock = (value: string | null) => value && /^\d{2}:\d{2}(?::\d{2})?$/.test(value) ? value : null;
const sources = ["Confirmed period schedule", "Weekly default", "Dated schedule", "Employee default"];

/** Explicit allowlist: canonical finding labels, warnings and punch reasons can
 * contain unbounded source/admin text. Only their codes and typed facts leave here. */
export function projectManagerAttendanceDay(day: ProvisionalDay, scope: { today: string; asOfDate: string; now?: Date }, schedule?: ShiftWindow, hasTimeOverride = false, leaveCoverage: ManagerLeaveCoverage = day.review?.approvedLeave ? "unverified" : "none", scheduledRestWork = false): ManagerAttendanceDay {
  // A workday crossing midnight remains underway until its resolved shift end.
  // This only changes review membership; payroll attendance arithmetic is untouched.
  const start = schedule?.checkInTime ? Date.parse(`${day.date}T${schedule.checkInTime}+08:00`) : NaN;
  let end = schedule?.checkOutTime ? Date.parse(`${day.date}T${schedule.checkOutTime}+08:00`) : NaN;
  if (end <= start) end += 86400000;
  const shiftUnderway = (!day.isRestDay || scheduledRestWork) && day.review?.scheduleConfigured && scope.now && start <= scope.now.getTime() && scope.now.getTime() < end;
  const phase: ManagerAttendanceDay["phase"] = day.review?.eligible === false ? "outside-employment"
    : day.date > scope.today ? "future" : day.date === scope.today || shiftUnderway ? "in-progress"
    : day.date > scope.asOfDate ? "after-cutoff" : "recorded";
  const reviewDay: ProvisionalDay = phase === "in-progress" ? { ...day, status: "In progress" } : day;
  const review = getProvisionalDayReview(reviewDay, scope);
  // Reuse only the missing-evidence rule for an explicit work arrangement. The
  // returned rest designation and every attendance/payroll quantity stay intact.
  if (scheduledRestWork && day.isRestDay && leaveCoverage === "none") {
    const missing = getProvisionalDayReview({ ...reviewDay, isRestDay: false }, scope).findings.find(finding => finding.code === "scheduled-no-attendance");
    if (missing) review.findings.push(missing);
  }
  const findings: ManagerAttendanceDay["findings"] = review.findings.map(finding => ({ code: finding.code, label: labels[finding.code], needsAction: review.inScope && finding.blocking }));
  if (leaveCoverage === "partial-day") findings.push({ code: "partial-leave", label: labels["partial-leave"], needsAction: review.inScope });
  return {
    date: day.date, phase,
    scheduleIn: clock(day.scheduleIn), scheduleOut: clock(day.scheduleOut),
    scheduleSource: sources.includes(day.scheduleSource) ? day.scheduleSource : "Employee default",
    scheduleConfigured: day.review?.scheduleConfigured === true, isRestDay: day.isRestDay === true, scheduledRestWork,
    breaks: (schedule?.regularBreakWindows ?? []).filter(window => clock(window.fromTime) && clock(window.toTime)).map(window => ({ fromTime: clock(window.fromTime)!, toTime: clock(window.toTime)!, requiresPunches: window.requiresPunches === true })),
    scheduledMinutes: minutes(day.scheduledMinutes), workedMinutes: minutes(day.workedMinutes), regularMinutes: minutes(day.regularMinutes),
    lateMinutes: minutes(day.review?.lateMinutes), undertimeMinutes: minutes(day.review?.undertimeMinutes), overtimeMinutes: minutes(day.review?.overtimeMinutes),
    hasTimeOverride: hasTimeOverride === true,
    overtimeApprovalOnFile: day.review?.overtimeApproved === true, approvedLeave: day.review?.approvedLeave === true || leaveCoverage !== "none", leaveCoverage,
    reviewedNoWork: day.review?.reviewedNoWork === true, held: day.payrollHold === true, correctedAt: iso(day.review?.correctedAt),
    findings, needsAction: findings.some(finding => finding.needsAction),
    punches: (day.attendance?.punches ?? []).map((punch, index): ManagerAttendanceDay["punches"][number] => ({
      // IDs are opaque UI keys, not source payloads or free-form raw-log identities.
      id: String(index + 1), type: punch.type === "IN" || punch.type === "OUT" ? punch.type : "UNSPECIFIED",
      at: iso(punch.at) ?? "", included: punch.included === true,
      state: states.includes(punch.evidenceState!) ? punch.evidenceState! : punch.included ? "effective" : "pending",
    })).filter(punch => punch.at !== ""),
  };
}

export function summarizeManagerAttendance(employees: ManagerOverviewEmployee[]): Pick<ManagerAttendanceOverview, "counts" | "issues"> {
  const completed = employees.flatMap(employee => employee.days.filter(day => day.phase === "recorded").map(day => ({ employee, day })));
  const has = (codes: ManagerFindingCode[]) => completed.filter(({ day }) => day.findings.some(finding => codes.includes(finding.code))).length;
  return {
    counts: { employees: employees.length, actionDays: completed.filter(({ day }) => day.needsAction).length,
      actionEmployees: employees.filter(employee => employee.actionDays > 0).length,
      scheduledNoAttendanceDays: has(["scheduled-no-attendance"]), punchProblemDays: has(["punches"]),
      scheduleProblemDays: has(["schedule", "rest-work"]), heldDays: has(["hold", "new-evidence"]), overtimeDays: has(["overtime"]) },
    issues: completed.flatMap(({ employee, day }) => day.findings.filter(finding => finding.needsAction).map(finding => ({ employeeId: employee.employeeId, name: employee.name, date: day.date, code: finding.code, label: finding.label })))
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)),
  };
}
