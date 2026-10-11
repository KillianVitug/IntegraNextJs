import type { ProvisionalDay, ProvisionalEmployee } from "./provisionalTypes";

export const provisionalViews = ["all", "attention", "scheduled-no-attendance", "punches", "schedule", "held", "late", "overtime", "pay", "no-work", "corrected"] as const;
export type ProvisionalView = typeof provisionalViews[number];
export type ProvisionalReviewScope = { asOfDate: string; today: string };
export type ProvisionalFinding = {
  code: "hold" | "new-evidence" | "punches" | "schedule" | "rest-work" | "scheduled-no-attendance" | "late" | "overtime" | "corrected";
  label: string;
  action: string;
  edit: "attendance" | "schedule";
  destination?: "hold";
  blocking: boolean;
};
export const provisionalViewLabels: Record<ProvisionalView, string> = {
  all: "All employees", attention: "Needs action", "scheduled-no-attendance": "Scheduled, no attendance",
  punches: "Missing / conflicting punches", schedule: "Schedule problems", held: "Held / new evidence",
  late: "Late / undertime", overtime: "Overtime review", pay: "Pay problems", "no-work": "Zero recorded earnings", corrected: "Corrected days",
};
export const provisionalViewDescriptions: Record<ProvisionalView, string> = {
  all: "All employees matching your search. Review counts cover completed workdays through the selected recorded date.",
  attention: "Unresolved attendance, schedule and recorded-pay findings. Open the dated reason to review it.",
  "scheduled-no-attendance": "Scheduled workdays with no attendance received. Check delivery or record the actual outcome; this does not establish absence.",
  punches: "Missing IN/OUT, required break pairs, or captures whose identity, time or sequence needs review.",
  schedule: "Recorded attendance without a configured working schedule, including work recorded on a rest day.",
  held: "Attendance held by an administrator or new evidence received after an approved decision.",
  late: "Recorded lateness and undertime. These are time details, not necessarily unresolved problems.",
  overtime: "Recorded overtime minutes and whether a day approval is on file. Approved and payable quantities may differ; review does not grant approval or guarantee payment.",
  pay: "Unavailable recorded estimates, recorded deduction shortfalls, or recorded work with zero earnings.",
  "no-work": "Employees with zero recorded gross earnings. This is separate from days without attendance.",
  corrected: "Completed workdays with saved corrections, including decisions saved after the selected recorded date.",
};
export function provisionalView(value: string | undefined): ProvisionalView {
  return provisionalViews.includes(value as ProvisionalView) ? value as ProvisionalView : "all";
}
export function provisionalEmployeeStatus(row: ProvisionalEmployee) {
  if (row.status === "No work — ₱0") return "Zero recorded earnings";
  if (row.status === "Unavailable") return !row.recorded ? "Recorded estimate unavailable" : !row.forecast ? "Forecast estimate unavailable" : "Estimate unavailable";
  return row.status;
}
export function attendanceReviewNote(value: string) {
  const labels: Record<string, string> = { MISSING_IN: "Missing IN", MISSING_OUT: "Missing OUT", ODD_PUNCH_COUNT: "Unpaired punch", INCOMPLETE_SEQUENCE: "Incomplete IN/OUT sequence", MISSING_SCHEDULE: "Schedule needed to calculate work", NO_SCHEDULE: "Schedule needed to calculate work" };
  return labels[value] || value.replaceAll("_", " ").toLowerCase().replace(/^./, char => char.toUpperCase());
}
export function attendanceReviewAction(day: ProvisionalDay) {
  return day.attendance?.canConfirmExisting ? "Review existing punches" : day.attendance?.missingDirection ? `Add missing ${day.attendance.missingDirection}` : day.status === "Incomplete" ? "Review attendance issue" : "View attendance";
}
const minutes = (value: number) => `${Math.round(value)} min`;
function hasAttendance(day: ProvisionalDay) {
  if (day.workedMinutes > 0) return true;
  if (!day.attendance) return day.punches.length > 0;
  return day.attendance.punches.some(punch => punch.included || (punch.evidenceState ? ["effective", "pending"].includes(punch.evidenceState) : !/^(Voided|Excluded|Original capture retained)/i.test(punch.reason ?? "")));
}
/** Findings describe the current effective inputs. The selected cutoff controls
 * list membership, not the audit history retained on a workday. */
export function getProvisionalDayReview(day: ProvisionalDay, scope: ProvisionalReviewScope) {
  const completed = day.date < scope.today && !["Future", "In progress"].includes(day.status);
  const inScope = completed && day.date <= scope.asOfDate && day.review?.eligible !== false;
  const findings: ProvisionalFinding[] = [];
  const add = (finding: ProvisionalFinding) => findings.push(finding);
  if (day.payrollHold || day.status === "Held time") add({ code: "hold", label: "Attendance time held by administrator decision", action: "Review held time", edit: "attendance", destination: "hold", blocking: true });
  if (day.attendance?.lateConflict) add({ code: "new-evidence", label: "New evidence received after the approved correction", action: "Review new evidence", edit: "attendance", blocking: true });
  const configured = day.review?.scheduleConfigured ?? day.status !== "Schedule missing";
  if (!configured && hasAttendance(day)) add({ code: "schedule", label: "Schedule needed to calculate recorded attendance", action: "Set schedule", edit: "schedule", blocking: true });
  if (day.isRestDay && hasAttendance(day)) add({ code: "rest-work", label: "Attendance recorded on a rest day", action: "Review rest-day schedule", edit: "schedule", blocking: false });
  const punchIssues = [...new Set((day.attendance?.issues ?? []).map(attendanceReviewNote))];
  if (!punchIssues.length && day.status === "Incomplete") punchIssues.push("Review the incomplete IN/OUT sequence");
  // The effective loader owns source resolution. Summary flags add genuine
  // required-pair problems that cannot be inferred from an alternating sequence.
  for (const flag of day.review?.anomalyFlags ?? []) {
    if (/MISSING|INCOMPLETE|ODD|UNPAIRED|PARTIAL/.test(flag) && !/SCHEDULE/.test(flag)) {
      const label = attendanceReviewNote(flag);
      if (!punchIssues.includes(label)) punchIssues.push(label);
    }
  }
  if (punchIssues.length) add({ code: "punches", label: punchIssues.join(" · "), action: attendanceReviewAction(day), edit: "attendance", blocking: true });
  if (completed && day.review?.eligible && configured && !day.isRestDay && day.scheduledMinutes > 0 && !hasAttendance(day) && !day.review.approvedLeave && !day.review.reviewedNoWork && !day.payrollHold && day.status !== "Held time" && !punchIssues.length) {
    add({ code: "scheduled-no-attendance", label: "Scheduled workday · no attendance received", action: "Review missing attendance", edit: "attendance", blocking: true });
  }
  const late = day.review?.lateMinutes ?? 0, undertime = day.review?.undertimeMinutes ?? 0;
  if (late > 0 || undertime > 0) add({ code: "late", label: [late > 0 ? `${minutes(late)} late` : "", undertime > 0 ? `${minutes(undertime)} undertime` : ""].filter(Boolean).join(" · "), action: "Review time details", edit: "attendance", blocking: false });
  if ((day.review?.overtimeMinutes ?? 0) > 0) add({ code: "overtime", label: `${minutes(day.review!.overtimeMinutes)} recorded overtime · ${day.review!.overtimeApproved ? "day approval on file" : "no day approval"}`, action: "Review overtime details", edit: "attendance", blocking: false });
  if (day.review?.correctedAt) add({ code: "corrected", label: "Saved attendance correction", action: "View corrected attendance", edit: "attendance", blocking: false });
  return { inScope, findings, needsAction: inScope && findings.some(finding => finding.blocking) };
}
export function findingsForProvisionalView(day: ProvisionalDay, view: ProvisionalView, scope: ProvisionalReviewScope) {
  const review = getProvisionalDayReview(day, scope);
  if (!review.inScope) return [];
  return review.findings.filter(finding => view === "all" || view === "attention" ? finding.blocking
    : view === "punches" ? finding.code === "punches"
    : view === "schedule" ? finding.code === "schedule" || finding.code === "rest-work"
    : view === "held" ? finding.code === "hold" || finding.code === "new-evidence"
    : view === "scheduled-no-attendance" ? finding.code === "scheduled-no-attendance"
    : view === "late" || view === "overtime" || view === "corrected" ? finding.code === view : false);
}
export function matchingProvisionalDays(row: ProvisionalEmployee, view: ProvisionalView, scope: ProvisionalReviewScope) {
  return row.days.filter(day => findingsForProvisionalView(day, view, scope).length > 0).sort((a, b) => a.date.localeCompare(b.date));
}
export function employeeReviewReasons(row: ProvisionalEmployee, view: ProvisionalView, scope: ProvisionalReviewScope) {
  if (!["all", "attention", "pay", "no-work"].includes(view)) return [];
  if (row.status === "Not scheduled this half") return [];
  const zero = row.recorded?.gross === 0;
  if (view === "no-work") return zero ? ["Zero recorded gross earnings"] : [];
  const reasons: string[] = [];
  if (!row.recorded) reasons.push("Recorded estimate unavailable");
  if ((row.recorded?.shortfall ?? 0) > 0) reasons.push("Recorded deductions exceed available earnings");
  if (zero && row.days.some(day => getProvisionalDayReview(day, scope).inScope && day.workedMinutes > 0)) reasons.push("Recorded work with zero recorded earnings");
  return reasons;
}
export function summarizeProvisionalView(rows: ProvisionalEmployee[], view: ProvisionalView, scope: ProvisionalReviewScope) {
  const matches = rows.map(row => ({ row, days: matchingProvisionalDays(row, view, scope), reasons: employeeReviewReasons(row, view, scope) })).filter(item => view === "all" || item.days.length > 0 || item.reasons.length > 0);
  if (!["all", "pay", "no-work"].includes(view)) {
    const priority = (item: typeof matches[number]) => {
      if (view !== "attention") return 0;
      if (!item.row.recorded) return 0;
      const codes = item.days.flatMap(day => findingsForProvisionalView(day, view, scope).map(finding => finding.code));
      return codes.some(code => ["hold", "new-evidence"].includes(code)) ? 0 : codes.includes("punches") ? 1 : codes.includes("schedule") ? 2 : item.reasons.length ? 2 : 3;
    };
    matches.sort((a, b) => priority(a) - priority(b) || (a.days[0]?.date ?? "").localeCompare(b.days[0]?.date ?? "") || a.row.name.localeCompare(b.row.name));
  }
  return { matches, employeeCount: matches.length, dayCount: matches.reduce((total, item) => total + item.days.length, 0) };
}
export function provisionalCountLabel(employeeCount: number, dayCount: number, includeDays = true) {
  return `${employeeCount} ${employeeCount === 1 ? "employee" : "employees"}${includeDays ? ` · ${dayCount} ${dayCount === 1 ? "day" : "days"}` : ""}`;
}
