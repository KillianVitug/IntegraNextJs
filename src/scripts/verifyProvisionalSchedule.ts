import assert from "node:assert/strict";
import { applyScheduleChanges, emptySchedule, withDateScheduleTimes } from "@/lib/scheduling/model";
import type { ScheduleSnapshot, ScheduleCell } from "@/lib/scheduling/workspace-types";

const base: ScheduleSnapshot = { ...emptySchedule("unconfigured"), kind: "shift", shiftTableId: 1, shiftName: "Day", shiftCode: "DAY", checkInTime: "08:00:00", checkOutTime: "17:00:00", breakMinutes: 60, hoursPerDay: 8, breaks: [{ slotKey: "mid_break", label: "Lunch", fromTime: "12:00:00", toTime: "13:00:00", deduct: true, deductHours: 1, deductMinutes: 0, sortOrder: 1 }] };
const changed = withDateScheduleTimes(base, { start: "09:00", end: "18:00" });
assert.equal(changed.hoursPerDay, 8); assert.equal(changed.shiftTableId, null); assert.equal(changed.checkInTime, "09:00:00"); assert.deepEqual(changed.breaks, base.breaks); assert.equal(base.checkInTime, "08:00:00");
assert.throws(() => withDateScheduleTimes(base, { start: "14:00", end: "18:00" }), /break falls outside/);
assert.throws(() => withDateScheduleTimes(base, { start: "08:00", end: "08:00" }), /working time/);
assert.throws(() => withDateScheduleTimes(base, { start: "24:00", end: "17:00" }), /valid/);
assert.throws(() => withDateScheduleTimes(emptySchedule("rest"), { start: "08:00", end: "17:00" }), /working shift/);
const night = withDateScheduleTimes({ ...base, breaks: [{ ...base.breaks[0], fromTime: "00:00:00", toTime: "01:00:00" }] }, { start: "21:00", end: "06:00" });
assert.equal(night.hoursPerDay, 8);
const cell = (day: string): ScheduleCell => ({ employeeId: "employee", day, value: "1", label: "Day", source: "Default", defaultValue: "1", defaultLabel: "Day", baselineValue: "1", baselineLabel: "Day", snapshot: base, baselineSnapshot: base, defaultSnapshot: base });
const cells = [cell("2026-10-01"), cell("2026-10-02")];
const result = applyScheduleChanges(cells, [{ employeeId: "employee", day: "2026-10-01", value: "captured", customTimes: { start: "09:00", end: "18:00" } }], new Map());
assert.equal(result[0].snapshot.checkInTime, "09:00:00"); assert.equal(result[1].snapshot.checkInTime, "08:00:00"); assert.equal(cells[0].snapshot.checkInTime, "08:00:00");
console.log("PASS provisional exact-day times, breaks, overnight validation and sibling preservation");
