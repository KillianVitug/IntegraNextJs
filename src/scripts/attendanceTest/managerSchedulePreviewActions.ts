/** Fictional browser action boundary only. No database, auth, source-service or production imports. */
import { applyScheduleChanges, emptySchedule, scheduleLabel } from "@/lib/scheduling/model";
import type { ScheduleActionResult, ScheduleCell, ScheduleDayHistoryEntry, ScheduleDayHistoryPage, ScheduleDayOperationCommand, ScheduleDayOperations, ScheduleReceipt, ScheduleSnapshot } from "@/lib/scheduling/workspace-types";
import type { ManagerAttendanceOverview, ManagerAttendanceDay } from "@/lib/manager/oversight-types";

const period = { id: "33333333-3333-4333-8333-333333333333", code: "2026-10-A", startDate: "2026-10-01", endDate: "2026-10-15" };
export const scheduleFixturePeople = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Sample Alvarez", employeeNo: "00991" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Sample Bautista", employeeNo: "00992" },
  { id: "44444444-4444-4444-8444-444444444444", name: "Sample Cruz", employeeNo: "00993" },
  { id: "55555555-5555-4555-8555-555555555555", name: "Sample Diaz", employeeNo: "00994" },
  { id: "66666666-6666-4666-8666-666666666666", name: "Sample Espino", employeeNo: "00995" },
];
const dates = ["2026-10-13", "2026-10-14", "2026-10-15"];
const first: ScheduleSnapshot = { kind: "shift", shiftTableId: 1, shiftName: "Day shift", shiftCode: "DAY", checkInTime: "08:00:00", checkOutTime: "17:00:00", breakMinutes: 60, paidBreakMinutes: 0, graceMinutes: 0, hoursPerDay: 8, isFlexible: false, breaks: [{ slotKey: "mid_break", label: "Lunch", fromTime: "12:00:00", toTime: "13:00:00", deduct: true, deductHours: 1, deductMinutes: 0, sortOrder: 1 }] };
const later: ScheduleSnapshot = { ...structuredClone(first), shiftTableId: 2, shiftName: "Later shift", shiftCode: "LATE", checkInTime: "09:00:00", checkOutTime: "18:00:00" };
const overnight: ScheduleSnapshot = { ...structuredClone(first), shiftTableId: 3, shiftName: "Overnight", shiftCode: "NIGHT", checkInTime: "22:00:00", checkOutTime: "07:00:00", breaks: [{ ...first.breaks[0], fromTime: "02:00:00", toTime: "03:00:00" }] };
const shifts = [first, later, overnight].map(snapshot => ({ id: snapshot.shiftTableId!, label: scheduleLabel(snapshot), checkInTime: snapshot.checkInTime!, checkOutTime: snapshot.checkOutTime!, snapshot }));
type FixtureState = { revision: number; cells: Record<string, ScheduleSnapshot>; history: Record<string, ScheduleDayHistoryEntry[]>; requests: Record<string, ScheduleDayHistoryPage["requests"]>; receipts: Record<string, ScheduleReceipt>; commands: ScheduleDayOperationCommand[]; attempts: string[]; failures: { refresh: number; interrupted: number; stale: number; uncertain: number; cancel: number } };
const scenario = typeof location === "undefined" ? "normal" : new URLSearchParams(location.search).get("case") ?? "normal";
const storageKey = `integra-fictional-manager-schedule-v1:${scenario}`;
const key = (employeeId: string, day: string) => `${employeeId}|${day}`;
function initial(): FixtureState {
  const cells: FixtureState["cells"] = {};
  for (const [index, employee] of scheduleFixturePeople.entries()) for (const day of dates) cells[key(employee.id, day)] = structuredClone(index === 1 ? later : index === 2 ? emptySchedule("unconfigured") : index === 3 ? emptySchedule("rest") : first);
  if (scenario === "rest-work") cells[key(scheduleFixturePeople[3].id, dates[0])] = { ...structuredClone(first), designatedRestDay: true };
  const history: FixtureState["history"] = scenario === "history" ? { [key(scheduleFixturePeople[0].id, dates[0])]: Array.from({ length: 21 }, (_, index) => ({ id: `fictional-history-${index}`, requestId: `fictional-operation-${index}`, day: dates[0], createdAt: new Date(Date.UTC(2026, 9, 14, 1, 21 - index)).toISOString(), actorName: "Sample Manager", actorRole: "MANAGER", before: structuredClone(index % 2 ? first : later), after: structuredClone(index % 2 ? later : first), operation: "adjust", linkedEmployees: [{ employeeId: scheduleFixturePeople[0].id, day: dates[0] }] })) } : {};
  return { revision: 1, cells, history, requests: {}, receipts: {}, commands: [], attempts: [], failures: { refresh: scenario === "refresh-failure" ? 1 : 0, interrupted: scenario === "interrupted" ? 1 : 0, stale: scenario === "stale" ? 1 : 0, uncertain: scenario === "unknown-outcome" ? 1 : 0, cancel: scenario === "cancel-interrupted" ? 1 : 0 } };
}
function restore(): FixtureState { try { const value = sessionStorage.getItem(storageKey); return value ? JSON.parse(value) as FixtureState : initial(); } catch { return initial(); } }
let state = restore();
function persist() {
  try { sessionStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Isolated in-memory preview still works without browser storage. */ }
  if (typeof document !== "undefined") { const output = document.getElementById("fixture-receipt"); if (output) output.textContent = JSON.stringify({ fictional: true, scenario, revision: state.revision, savedCommands: state.commands.length, requestIds: state.commands.map(row => row.requestId), attemptedRequestIds: state.attempts, receipts: Object.values(state.receipts).map(row => ({ action: row.action, outcome: row.outcome, changedCount: row.changedCount })) }); }
}
export function resetManagerScheduleFixture() { state = initial(); persist(); }
function cellFor(employeeId: string, day: string): ScheduleCell {
  const snapshot = state.cells[key(employeeId, day)];
  if (!snapshot) throw new Error("Fictional employee/date is outside this preview.");
  return { employeeId, day, value: snapshot.kind === "shift" ? String(snapshot.shiftTableId ?? "captured") : snapshot.kind, label: scheduleLabel(snapshot), source: "Confirmed period schedule", defaultValue: "1", defaultLabel: scheduleLabel(first), baselineValue: snapshot.kind === "shift" ? String(snapshot.shiftTableId ?? "captured") : snapshot.kind, baselineLabel: scheduleLabel(snapshot), snapshot: structuredClone(snapshot), defaultSnapshot: structuredClone(first), baselineSnapshot: structuredClone(snapshot), latestDefaultSnapshot: structuredClone(first) };
}
function historyFor(employeeId: string, day: string, cursor?: string): ScheduleDayHistoryPage {
  const offset = cursor ? Number(cursor) : 0, entries = state.history[key(employeeId, day)] ?? [];
  return structuredClone({ entries: entries.slice(offset, offset + 20), nextCursor: offset + 20 < entries.length ? String(offset + 20) : null, requests: state.requests[key(employeeId, day)] ?? [] });
}
export async function getScheduleDayOperations({ employeeId, day }: { employeeId: string; day: string; periodId?: string }): Promise<ScheduleDayOperations> {
  const cell = cellFor(employeeId, day);
  return { departmentId: 1, periodId: period.id, sourceDigest: `fixture-${state.revision}`, expectedDraftId: null, expectedDraftRevision: null, cell, pendingDraftCell: null, shifts: structuredClone(shifts), history: historyFor(employeeId, day), reviewRequired: scenario === "reviewed", restrictions: [], reviewReasons: scenario === "reviewed" ? ["This employee's work is already reviewed."] : [],
    candidates: scheduleFixturePeople.filter(person => person.id !== employeeId).map(person => { const snapshot = state.cells[key(person.id, day)]; return { employeeId: person.id, employeeNo: person.employeeNo, name: person.name, day, snapshot: structuredClone(snapshot), label: scheduleLabel(snapshot), restrictions: person === scheduleFixturePeople[4] ? ["Approved leave conflicts with this proposed replacement."] : [], requiresReview: snapshot.kind === "rest", reviewReasons: snapshot.kind === "rest" ? ["The replacement has a designated rest day."] : [] }; }),
  };
}
export async function getScheduleDayHistory({ employeeId, day, cursor }: { employeeId: string; day: string; periodId?: string; cursor?: string }) { return historyFor(employeeId, day, cursor); }
export async function getScheduleRequestReceipt(requestId: string) { return structuredClone(state.receipts[requestId] ?? null); }
export async function cancelScheduleOperationRequest({ requestId }: { requestId: string }): Promise<ScheduleActionResult> {
  const receipt = state.receipts[requestId];
  if (!receipt) return { ok: false, error: "Fictional request unavailable." };
  if (receipt.outcome !== "pending-review" && receipt.outcome !== "cancelled") return { ok: false, error: "Only a pending request may be cancelled." };
  for (const requests of Object.values(state.requests)) for (const request of requests) if (request.id === requestId) { request.status = "Cancelled"; request.canCancel = false; request.decidedAt = "2026-10-14T03:00:00Z"; }
  state.receipts[requestId] = { ...receipt, outcome: "cancelled", message: "Your pending request was cancelled. Active schedules remain unchanged." };
  persist();
  if (state.failures.cancel) { state.failures.cancel--; persist(); throw new Error("Fictional interrupted cancellation response."); }
  return { ok: true, receipt: structuredClone(state.receipts[requestId]) };
}
export async function submitScheduleDayOperation(input: ScheduleDayOperationCommand): Promise<ScheduleActionResult> {
  state.attempts ??= []; state.attempts.push(input.requestId);
  if (state.receipts[input.requestId]) return { ok: true, receipt: structuredClone(state.receipts[input.requestId]) };
  if (state.failures.uncertain) { state.failures.uncertain--; persist(); return { ok: false, uncertain: true, error: "Fictional unconfirmed action outcome." }; }
  if (state.failures.stale) { state.failures.stale--; state.revision++; persist(); return { ok: false, error: "Schedules changed while you were editing. Reload current schedules, review the comparison and try again. Your entries are retained." }; }
  if (input.sourceDigest !== `fixture-${state.revision}`) return { ok: false, error: "Schedules changed. Reload current schedules before confirming." };
  const primary = cellFor(input.employeeId, input.day), other = input.replacementEmployeeId ? cellFor(input.replacementEmployeeId, input.day) : null;
  if (other && input.replacementEmployeeId === scheduleFixturePeople[4].id) return { ok: false, error: "Approved leave conflicts with the replacement's schedule." };
  const changes = input.operation === "adjust"
    ? [{ employeeId: input.employeeId, before: primary.snapshot, after: applyScheduleChanges([primary], [{ employeeId: input.employeeId, day: input.day, value: input.value ?? "", customTimes: input.customTimes }], new Map(shifts.map(shift => [String(shift.id), shift.snapshot])))[0].snapshot }]
    : other ? [...(input.operation === "swap" ? [{ employeeId: input.employeeId, before: primary.snapshot, after: other.snapshot }] : []), { employeeId: other.employeeId, before: other.snapshot, after: primary.snapshot }] : [];
  const pendingReview = scenario === "reviewed" && input.operation !== "cover" || changes.some(change => change.before.kind === "rest" && change.after.kind === "shift");
  const linkedEmployees = [{ employeeId: input.employeeId, day: input.day }, ...(other ? [{ employeeId: other.employeeId, day: input.day }] : [])];
  const at = new Date(Date.UTC(2026, 9, 14, 2, state.commands.length)).toISOString();
  const receipt: ScheduleReceipt = { requestId: input.requestId, action: pendingReview ? "schedule_requested" : "days_confirmed", outcome: pendingReview ? "pending-review" : "applied", operation: input.operation, changedCount: pendingReview ? 0 : changes.length, message: pendingReview ? "Request saved for Payroll Admin. Active schedules and attendance findings are unchanged." : "Schedule saved and attendance inputs refreshed. Official payroll was not posted; affected payroll needs fresh review.", ...(pendingReview ? { reviewRequestId: input.requestId } : {}), linkedEmployees };
  state.commands.push(structuredClone(input)); state.receipts[input.requestId] = receipt;
  if (pendingReview) {
    for (const link of linkedEmployees) { const scopeKey = key(link.employeeId, link.day); state.requests[scopeKey] = [{ id: input.requestId, operation: input.operation, status: "Pending", canCancel: true, createdAt: at, decidedAt: null, reasons: ["Payroll Admin review required for this arrangement."] }, ...(state.requests[scopeKey] ?? [])]; }
  } else {
    const auditedChanges = input.operation === "cover" ? [{ employeeId: input.employeeId, before: primary.snapshot, after: primary.snapshot }, ...changes] : changes;
    for (const [index, change] of auditedChanges.entries()) {
      const scopeKey = key(change.employeeId, input.day); state.cells[scopeKey] = structuredClone(change.after);
      state.history[scopeKey] = [{ id: `${input.requestId}-${index}`, requestId: input.requestId, day: input.day, createdAt: at, actorName: "Sample Manager", actorRole: "MANAGER", before: structuredClone(change.before), after: structuredClone(change.after), operation: input.operation, note: input.note, linkedEmployees }, ...(state.history[scopeKey] ?? [])];
    }
    state.revision++;
  }
  persist();
  if (state.failures.interrupted) { state.failures.interrupted--; persist(); throw new Error("Fictional response interruption after saved receipt."); }
  return { ok: true, receipt: structuredClone(receipt) };
}

export function getFixtureOverview(): ManagerAttendanceOverview {
  const employees = scheduleFixturePeople.map((person, index) => {
    const days = dates.map((date): ManagerAttendanceDay => {
      const snapshot = state.cells[key(person.id, date)], recorded = date === dates[0];
      const findings: ManagerAttendanceDay["findings"] = !recorded ? [] : index === 0 ? [{ code: "punches", label: "Missing or conflicting punches; review the workday", needsAction: true }] : snapshot.kind === "shift" && index !== 4 ? [{ code: "scheduled-no-attendance", label: "Scheduled workday; no attendance received", needsAction: true }] : [];
      return { date, phase: recorded ? "recorded" : date === dates[1] ? "in-progress" : "future", scheduleIn: snapshot.checkInTime, scheduleOut: snapshot.checkOutTime, scheduleSource: "Confirmed period schedule", scheduleConfigured: snapshot.kind !== "unconfigured", isRestDay: snapshot.kind === "rest" || snapshot.designatedRestDay === true, scheduledRestWork: snapshot.kind === "shift" && snapshot.designatedRestDay === true, breaks: snapshot.breaks.map(row => ({ fromTime: row.fromTime, toTime: row.toTime, requiresPunches: row.requiresPunches === true })), scheduledMinutes: snapshot.hoursPerDay * 60, workedMinutes: 0, regularMinutes: 0, lateMinutes: 0, undertimeMinutes: 0, overtimeMinutes: 0, hasTimeOverride: false, overtimeApprovalOnFile: false, approvedLeave: index === 4, leaveCoverage: index === 4 ? "full-day" : "none", reviewedNoWork: false, held: false, correctedAt: null, findings, needsAction: findings.some(row => row.needsAction), punches: index === 0 && recorded ? [{ id: "fictional-in", type: "IN", at: "2026-10-13T00:00:00Z", included: true, state: "effective" }] : [] };
    });
    return { employeeId: person.id, employeeNo: person.employeeNo, name: person.name, days, actionDays: days.filter(day => day.needsAction).length };
  });
  const allDays = employees.flatMap(person => person.days), issues = employees.flatMap(person => person.days.flatMap(day => day.findings.filter(finding => finding.needsAction).map(finding => ({ employeeId: person.employeeId, name: person.name, date: day.date, code: finding.code, label: finding.label }))));
  return { departments: [{ id: 1, name: "Sample branch" }], departmentId: 1, period, periods: [period], asOfDate: dates[0], today: dates[1], generatedAt: "2026-10-14T02:00:00Z", freshness: { state: "unknown", lastSourceSeenAt: null, message: "Fictional delivery completeness is unverified." }, scopeNotice: "Fictional scoped employees. Attendance review does not approve payroll.", employees, issues,
    counts: { employees: employees.length, actionEmployees: employees.filter(person => person.actionDays > 0).length, actionDays: allDays.filter(day => day.needsAction).length, scheduledNoAttendanceDays: allDays.filter(day => day.findings.some(finding => finding.code === "scheduled-no-attendance")).length, punchProblemDays: 1, scheduleProblemDays: 0, heldDays: 0, overtimeDays: 0 } };
}
export function installManagerScheduleFixtureFetch() {
  window.fetch = async (request: RequestInfo | URL) => {
    const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url, location.origin);
    if (url.pathname !== "/api/manager/provisional") throw new Error("This fictional preview has no production network access.");
    if (state.failures.refresh && state.commands.length) { state.failures.refresh--; persist(); return new Response(JSON.stringify({ error: "Fictional refresh failure" }), { status: 503 }); }
    const overview = getFixtureOverview(), employeeId = url.searchParams.get("employeeId");
    if (employeeId) { overview.employees = overview.employees.filter(row => row.employeeId === employeeId); overview.issues = overview.issues.filter(row => row.employeeId === employeeId); overview.counts.employees = overview.employees.length; overview.counts.actionEmployees = overview.employees.filter(row => row.actionDays > 0).length; overview.counts.actionDays = overview.employees.reduce((count, row) => count + row.actionDays, 0); }
    return new Response(JSON.stringify(overview), { headers: { "Content-Type": "application/json" } });
  };
  persist();
}
