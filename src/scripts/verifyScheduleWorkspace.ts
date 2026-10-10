import assert from "node:assert/strict";
import { applyScheduleChanges, emptySchedule, sameSchedule, scheduleDateRange, scheduleLabel, shiftDate } from "@/lib/scheduling/model";
import type { ScheduleCell, ScheduleSnapshot } from "@/lib/scheduling/workspace-types";
import { resolveEmployeeScheduleForDate } from "@/lib/payroll/scheduleResolver";
import { compareScheduleSnapshots, compareShiftTableSchedules, describeSchedule, shiftTableScheduleLabel, shiftTableScheduleSnapshot } from "@/lib/scheduling/presentation";
import type { ShiftTableReadModel } from "@/lib/shifts";

const original: ScheduleSnapshot = { ...emptySchedule("unconfigured"), kind: "shift", shiftTableId: 1, shiftName: "Night shift", shiftCode: "N", checkInTime: "22:00:00", checkOutTime: "06:00:00", hoursPerDay: 8 };
const next = { ...original, shiftTableId: 2, shiftName: "Day", shiftCode: "D", checkInTime: "08:00:00", checkOutTime: "17:00:00", breakMinutes: 60 };
const cell: ScheduleCell = { employeeId: "employee", day: "2026-09-30", value: "1", label: scheduleLabel(original), source: "Date exception", defaultValue: "rest", defaultLabel: "Rest day", baselineValue: "1", baselineLabel: scheduleLabel(original), snapshot: original, baselineSnapshot: original, defaultSnapshot: emptySchedule("rest"), latestDefaultSnapshot: next };
assert.deepEqual(scheduleDateRange("2026-09-28", "2026-09-30"), ["2026-09-28", "2026-09-29", "2026-09-30"]);
assert.equal(shiftDate("2026-10-01", -1), "2026-09-30");
assert.ok(sameSchedule(original, Object.fromEntries(Object.entries(original).reverse()) as ScheduleSnapshot), "JSONB property order must not create false schedule changes");
const templates = new Map([["1", original], ["2", next]]);
assert.equal(applyScheduleChanges([cell], [{ employeeId: cell.employeeId, day: cell.day, value: "1" }], new Map([["1", { ...original, breakMinutes: 30 }]]))[0].snapshot.breakMinutes, 30, "Explicitly selecting the same template adopts its current reviewed values");
assert.ok(sameSchedule(applyScheduleChanges([cell], [{ employeeId: cell.employeeId, day: cell.day, value: "1" }], new Map())[0].snapshot, original), "A deleted template's captured original remains selectable for undo");
const draftCell = { ...cell, value: "captured", snapshot: { ...next, shiftTableId: null } };
assert.ok(sameSchedule(applyScheduleChanges([draftCell], [{ employeeId: cell.employeeId, day: cell.day, value: "saved" }], new Map())[0].snapshot, draftCell.snapshot), "Saved values restore the original draft, including a custom or archived definition different from the baseline");
assert.ok(sameSchedule(applyScheduleChanges([draftCell], [{ employeeId: cell.employeeId, day: cell.day, value: "captured" }], new Map())[0].snapshot, original), "Baseline captured values remain distinct from saved draft values");
const update = applyScheduleChanges([cell], [{ employeeId: cell.employeeId, day: cell.day, value: "2" }], templates);
assert.equal(update[0].snapshot.checkInTime, "08:00:00"); assert.equal(cell.snapshot.checkInTime, "22:00:00");
assert.equal(applyScheduleChanges([cell], [{ employeeId: cell.employeeId, day: cell.day, value: "default" }], templates)[0].snapshot.kind, "rest", "Restore uses captured period default");
assert.equal(applyScheduleChanges([cell], [{ employeeId: cell.employeeId, day: cell.day, value: "latest-default" }], templates)[0].snapshot.checkInTime, "08:00:00", "Latest defaults require explicit adoption");
assert.equal(applyScheduleChanges([cell], [{ employeeId: cell.employeeId, day: cell.day, value: "unconfigured" }], templates)[0].snapshot.kind, "unconfigured");
assert.throws(() => applyScheduleChanges([cell], [{ employeeId: cell.employeeId, day: "2026-10-01", value: "2" }], templates), /outside/);
assert.throws(() => applyScheduleChanges([cell], [{ employeeId: cell.employeeId, day: cell.day, value: "999" }], templates), /no longer available/);
assert.throws(() => applyScheduleChanges([cell], [{ employeeId: cell.employeeId, day: cell.day, value: "2" }, { employeeId: cell.employeeId, day: cell.day, value: "rest" }], templates), /more than once/);
const missing = resolveEmployeeScheduleForDate({ attendanceDate: cell.day, assignments: [], weeklyPatterns: [], legacyTimekeeping: null });
assert.equal(missing.configured, false);
// Work periods describe the captured break windows, not a newly invented punch policy.
const split: ScheduleSnapshot = { ...next, shiftCode: "SPLIT - N", checkOutTime: "21:00:00", breakMinutes: 300, breaks: [
  { slotKey: "break_1", label: "Break 1", fromTime: "17:00:00", toTime: "17:30:00", deduct: true, deductHours: 0, deductMinutes: 30, sortOrder: 2 },
  { slotKey: "mid_break", label: "Mid Breaktime", fromTime: "12:00:00", toTime: "16:30:00", deduct: true, deductHours: 4, deductMinutes: 30, sortOrder: 1 },
] };
const splitBefore = structuredClone(split);
assert.equal(describeSchedule(split).periodsLabel, "08:00–12:00 / 16:30–17:00 / 17:30–21:00");
assert.doesNotMatch(scheduleLabel(split), /SPLIT - N|Day/);
assert.match(scheduleLabel(split), /4 punches minimum/);
assert.deepEqual(split, splitBefore, "Formatting must preserve captured break values and order");
const intended: ScheduleSnapshot = { ...split, calculationPolicy: "eight_hour_day", punchPolicy: "split_gaps", hoursPerDay: 8.5, breakMinutes: 270, breaks: [{ ...split.breaks[1], fromTime: "11:00", toTime: "15:30", requiresPunches: true }] };
assert.equal(describeSchedule(intended).periodsLabel, "08:00–11:00 / 15:30–21:00");
assert.match(scheduleLabel(intended), /8h normal \+ 0.5h OT/);
assert.match(scheduleLabel(intended), /4 punches required/);
const everyGap: ScheduleSnapshot = { ...split, punchPolicy: "split_gaps", breaks: split.breaks.map(row => ({ ...row, requiresPunches: true })) };
assert.match(scheduleLabel(everyGap), /6 punches required/);
assert.match(scheduleLabel({ ...everyGap, punchPolicy: "outer" }), /2 punches required/);
assert.notEqual(scheduleLabel(everyGap), scheduleLabel(split), "Identical periods with different punch requirements remain distinguishable");
assert.notEqual(scheduleLabel({ ...intended, calculationPolicy: "legacy" }), scheduleLabel(intended), "Identical periods with different pay policies remain distinguishable");
const mixed = { ...split, hoursPerDay: 12.5, breakMinutes: 30, paidBreakMinutes: 60, breaks: [
  { ...split.breaks[1], fromTime: "12:00", toTime: "13:00", deductHours: 0, deductMinutes: 30 },
  { ...split.breaks[0], deduct: false },
  { ...split.breaks[0], slotKey: "ot_break_1" as const, fromTime: "21:00", toTime: "21:15", deductMinutes: 15, sortOrder: 6 },
] };
assert.equal(describeSchedule(mixed).periodsLabel, "08:00–12:00 / 13:00–17:00 / 17:30–21:00", "Paid and partly paid breaks are still nonworking periods; OT breaks stay separate");
assert.match(scheduleLabel(mixed), /12:00–13:00 \(30 min unpaid \/ 30 min paid\); 17:00–17:30 \(30 min paid\) · OT breaks 21:00–21:15 \(15 min unpaid\)/);
const overnight = { ...original, hoursPerDay: 7, breakMinutes: 60, breaks: [{ ...split.breaks[1], fromTime: "02:00", toTime: "03:00", deductHours: 1, deductMinutes: 0 }] };
assert.equal(describeSchedule(overnight).periodsLabel, "22:00–02:00 (+1 day) / 03:00 (+1 day)–06:00 (+1 day)");
const crossing = { ...overnight, breaks: [{ ...overnight.breaks[0], fromTime: "23:30", toTime: "00:30" }] };
assert.equal(describeSchedule(crossing).periodsLabel, "22:00–23:30 / 00:30 (+1 day)–06:00 (+1 day)");
assert.match(scheduleLabel(next), /60 min unpaid \/ 0 min paid break.*Break times not configured/);
assert.equal(describeSchedule(next).periodsLabel, "08:00–17:00", "Missing break windows must not create guessed periods");
assert.equal(describeSchedule({ ...original, isFlexible: true, checkInTime: null, checkOutTime: null }).periodsLabel, "Flexible schedule");
assert.equal(describeSchedule({ ...original, checkInTime: "25:00" }).periodsLabel, "Schedule times unavailable");
const invalid = { ...intended, breaks: [{ ...intended.breaks[0], fromTime: "24:00" }] };
assert.match(scheduleLabel(invalid), /Break settings need review/);
assert.match(scheduleLabel(invalid), /Punch requirements need review/);
assert.equal(describeSchedule(invalid).periodsLabel, "08:00–21:00");
const outside = { ...intended, breaks: [{ ...intended.breaks[0], fromTime: "06:00", toTime: "10:30" }] };
assert.match(scheduleLabel(outside), /Break falls outside scheduled times/);
const overlap = { ...everyGap, breaks: [everyGap.breaks[1], { ...everyGap.breaks[0], fromTime: "16:00", toTime: "16:30" }] };
assert.match(scheduleLabel(overlap), /Break windows overlap/);
assert.equal(describeSchedule(overlap).periodsLabel, "08:00–21:00");
assert.match(scheduleLabel({ ...intended, breaks: [{ ...intended.breaks[0], deductHours: 8 }] }), /deduction needs review/);
assert.match(scheduleLabel({ ...intended, breakMinutes: 300 }), /Saved break totals differ/);
assert.equal(describeSchedule({ ...original, checkInTime: "08:00:15", checkOutTime: "16:00:15" }).periodsLabel, "08:00:15–16:00:15");
const sorted = [original, intended, { ...original, shiftTableId: 4, checkInTime: "04:00", checkOutTime: "12:00" }].sort(compareScheduleSnapshots);
assert.deepEqual(sorted.map(row => row.checkInTime), ["04:00", "08:00:00", "22:00:00"], "Sorting is numeric chronology, not the hidden code/name");
const earlyGap = { ...intended, shiftTableId: 5, breaks: [{ ...intended.breaks[0], fromTime: "10:00", toTime: "14:30" }] };
assert.ok(compareScheduleSnapshots(earlyGap, intended) < 0, "Subsequent boundaries break ties between equal starting times");
assert.notEqual(compareScheduleSnapshots(intended, { ...intended, graceMinutes: 5 }), 0, "Equal periods with different grace stay distinguishable");
const lookup: ShiftTableReadModel = { id: 42, code: "hidden-name", description: "hidden-description", regularStartTime: "08:00", regularEndTime: "21:00", deductibleBreakMinutes: 270, paidBreakMinutes: 0, hoursPerDay: 8.5, calculationPolicy: "eight_hour_day", punchPolicy: "split_gaps", breaks: [...intended.breaks, { ...split.breaks[0], fromTime: null, toTime: null, deduct: false, deductMinutes: 0 }] };
const lookupBefore = structuredClone(lookup);
const bridged = shiftTableScheduleSnapshot(lookup);
assert.equal(bridged.shiftTableId, 42); assert.equal(bridged.shiftCode, lookup.code);
assert.equal(bridged.breaks.length, 1); assert.equal(bridged.breaks[0].requiresPunches, true);
assert.equal(bridged.calculationPolicy, "eight_hour_day"); assert.equal(bridged.punchPolicy, "split_gaps");
assert.match(shiftTableScheduleLabel(lookup), /^08:00–11:00 \/ 15:30–21:00/);
assert.doesNotMatch(shiftTableScheduleLabel(lookup), /hidden-/);
assert.ok(compareShiftTableSchedules(lookup, { ...lookup, id: 43 }) < 0, "Distinct identical options have a stable ID tie-break; no deduplication");
assert.deepEqual(lookup, lookupBefore, "Lookup formatting must not mutate templates or break objects");
assert.equal(scheduleLabel(emptySchedule("rest")), "Rest day");
assert.equal(scheduleLabel(emptySchedule("unconfigured")), "Unconfigured");
console.log("PASS schedule workspace: exact dates, immutable edits, captured/latest defaults, missing/rest distinction, JSONB equality, scope and duplicate validation");
console.log("PASS schedule presentation: work periods, hidden names, explicit and legacy policies, paid/partial/OT breaks, overnight, invalid/missing fallbacks, captured immutability, chronological sorting and stable distinct IDs");
