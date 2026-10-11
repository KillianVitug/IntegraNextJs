import assert from "node:assert/strict";
import { employeeReviewReasons, findingsForProvisionalView, getProvisionalDayReview, matchingProvisionalDays, provisionalEmployeeStatus, provisionalView, summarizeProvisionalView } from "@/lib/payroll/provisionalReview";
import { reviewFixtureDay as day, reviewFixtureEmployee as employee, reviewFixtureRows, reviewFixtureScope as scope } from "./provisionalReviewFixture";

const original = JSON.stringify(reviewFixtureRows);
const basic = day(), metadata = basic.review!;
assert.equal(getProvisionalDayReview(basic, scope).needsAction, true);
assert.equal(findingsForProvisionalView(basic, "scheduled-no-attendance", scope).length, 1);
for (const excluded of [
  day({ date: "2026-10-10" }), day({ date: "2026-10-11", status: "In progress" }), day({ date: "2026-10-12", status: "Future" }),
  day({ review: { ...metadata, eligible: false } }), day({ isRestDay: true, status: "Rest day" }),
  day({ status: "Paid leave", review: { ...metadata, approvedLeave: true } }),
  day({ review: { ...metadata, reviewedNoWork: true } }), day({ payrollHold: true, status: "Held time" }),
  day({ review: undefined }), day({ review: { ...metadata, scheduleConfigured: false }, status: "Schedule missing" }),
]) assert.equal(findingsForProvisionalView(excluded, "scheduled-no-attendance", scope).length, 0, JSON.stringify(excluded));
const pending = day({ attendance: { punches: [{ id: "bad", at: "2026-10-02T00:00:00Z", type: "IN", included: false, reason: "Device clock needs verification" }], issues: ["Device clock needs verification"], missingDirection: null, complete: false, canConfirmExisting: false } });
assert.equal(findingsForProvisionalView(pending, "scheduled-no-attendance", scope).length, 0, "Captured but held attendance is not missing attendance");
assert.equal(findingsForProvisionalView(pending, "punches", scope).length, 1);
const corrected = reviewFixtureRows[2].days[0];
assert.equal(getProvisionalDayReview(corrected, scope).needsAction, false, "Resolved corrections and lateness/approved OT are not open findings");
assert.equal(findingsForProvisionalView(corrected, "corrected", scope).length, 1, "Correction saved after cutoff still belongs to the corrected workday");
assert.equal(findingsForProvisionalView(corrected, "late", scope)[0].label, "15 min late");
assert.equal(findingsForProvisionalView(corrected, "overtime", scope)[0].label, "30 min recorded overtime · day approval on file");
assert.equal(findingsForProvisionalView({ ...corrected, review: { ...corrected.review!, overtimeApproved: false } }, "overtime", scope)[0].label, "30 min recorded overtime · no day approval");
assert.equal(getProvisionalDayReview({ ...corrected, attendance: { ...corrected.attendance!, lateConflict: true } }, scope).needsAction, true);
assert.equal(getProvisionalDayReview({ ...corrected, payrollHold: true }, scope).needsAction, true);
assert.equal(findingsForProvisionalView({ ...corrected, review: { ...metadata, anomalyFlags: ["MISSING_BREAK_OUT", "MISSING_BREAK_IN"] } }, "punches", scope).length, 1, "Required split pairs remain actionable after a complete outer pair");
assert.equal(findingsForProvisionalView({ ...corrected, isRestDay: true }, "schedule", scope).length, 1);
assert.equal(getProvisionalDayReview({ ...corrected, isRestDay: true }, scope).needsAction, false, "Legitimate rest-day work is filterable without an unresolved blocker");
assert.equal(findingsForProvisionalView({ ...corrected, review: { ...metadata, scheduleConfigured: false } }, "schedule", scope).length, 1);
const historyOnly = day({ isRestDay: true, status: "Rest day", punches: ["Old voided IN"], attendance: { punches: [{ id: "old", type: "IN", at: "2026-10-02T00:00:00Z", included: false, reason: "Retained for audit", evidenceState: "resolved" }], issues: [], missingDirection: null, complete: false, canConfirmExisting: false } });
assert.equal(findingsForProvisionalView(historyOnly, "schedule", scope).length, 0, "Retained history is not current rest-day attendance");
assert.equal(findingsForProvisionalView({ ...historyOnly, isRestDay: false, status: "Schedule missing", review: { ...metadata, scheduleConfigured: false } }, "schedule", scope).length, 0, "Retained history cannot invent work without schedule");
assert.equal(findingsForProvisionalView({ ...historyOnly, isRestDay: false, status: "No work recorded" }, "scheduled-no-attendance", scope).length, 1, "Inactive history alone cannot hide an unreviewed scheduled day");
const zeroWithWork = employee("zero-work", [corrected], { recorded: { gross: 0, deductions: 0, net: 0, shortfall: 0 } });
assert.deepEqual(employeeReviewReasons(zeroWithWork, "pay", scope), ["Recorded work with zero recorded earnings"]);
assert.equal(summarizeProvisionalView([zeroWithWork], "no-work", scope).employeeCount, 1);
assert.equal(summarizeProvisionalView([employee("paid-no-captures", [basic])], "scheduled-no-attendance", scope).employeeCount, 1, "Positive earnings must not conceal missing attendance");
assert.equal(summarizeProvisionalView([employee("monthly-off", [corrected], { status: "Not scheduled this half", scheduledThisHalf: false, recorded: null, forecast: null })], "pay", scope).employeeCount, 0);
assert.equal(summarizeProvisionalView([employee("shortfall", [], { recorded: { gross: 100, deductions: 100, net: 0, shortfall: 50 } })], "pay", scope).employeeCount, 1);
assert.equal(summarizeProvisionalView([employee("forecast-shortfall", [], { forecast: { gross: 100, deductions: 100, net: 0, shortfall: 50 } })], "pay", scope).employeeCount, 0, "Future shortfalls do not become recorded-pay findings");
assert.equal(summarizeProvisionalView([employee("forecast-unavailable", [], { forecast: null, status: "Unavailable" })], "pay", scope).employeeCount, 0, "Unavailable forecast is not unavailable recorded pay");
assert.equal(provisionalEmployeeStatus(employee("forecast-unavailable", [], { forecast: null, status: "Unavailable" })), "Forecast estimate unavailable");
const attention = summarizeProvisionalView(reviewFixtureRows, "attention", scope);
assert.equal(attention.employeeCount, 3);
assert.equal(attention.dayCount, 4, "A held/conflicted day is counted once, employee pay issues invent no dates");
assert.deepEqual(attention.matches.map(item => item.row.employeeId), ["E", "B", "A"], "Unavailable/held findings precede routine missing-attendance review");
assert.equal(summarizeProvisionalView(reviewFixtureRows.filter(row => row.name.endsWith("A")), "attention", scope).employeeCount, 1, "Counts follow search input rows");
assert.deepEqual(matchingProvisionalDays(employee("order", [day({ date: "2026-10-05" }), basic]), "attention", scope).map(item => item.date), ["2026-10-02", "2026-10-05"]);
assert.equal(provisionalView("no-work"), "no-work", "Existing zero-earnings links remain supported");
assert.equal(provisionalView("not-a-view"), "all");
assert.equal(JSON.stringify(reviewFixtureRows), original, "Filtering must not change financial values or source evidence");
console.log("PASS ProvisionalReview: cutoff/ongoing eligibility, leave/rest/reviewed no-work, held captures, resolved/current conflicts, required pairs, pay/zero distinction, overtime state, monthly half, deduped/search counts and immutable inputs");
