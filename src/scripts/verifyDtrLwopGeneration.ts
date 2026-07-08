import assert from "node:assert/strict";
import { computeGeneratedDtrLwopMinutes } from "@/lib/payroll/dtrLwop";
import { applyAttendanceDtrStatusOverride } from "@/lib/payroll/dtrOverrides";

const baseAttendanceRow = {
  scheduledMinutes: 480,
  workedMinutes: 480,
  regularMinutes: 480,
  lateMinutes: 0,
  undertimeMinutes: 0,
  overtimeMinutes: 0,
  nightMinutes: 0,
  paidLeaveMinutes: 0,
  unpaidLeaveMinutes: 0,
  absentMinutes: 0,
  isRestDay: false,
  firstInAt: new Date("2026-03-02T08:00:00Z"),
  lastOutAt: new Date("2026-03-02T17:00:00Z"),
  rawPunches: [],
  anomalyFlags: [],
};

assert.equal(
  computeGeneratedDtrLwopMinutes({
    undertimeMinutes: 30,
    absentDays: 0,
  }),
  30,
  "UT-only DTR LWOP quantity should equal UT minutes."
);

assert.equal(
  computeGeneratedDtrLwopMinutes({
    undertimeMinutes: 0,
    absentDays: 1,
  }),
  480,
  "One DTR absence should add 8 LWOP hours."
);

assert.equal(
  computeGeneratedDtrLwopMinutes({
    undertimeMinutes: 30,
    absentDays: 1,
  }),
  510,
  "DTR absence and UT should combine into one LWOP quantity."
);

const absentOverrideRow = applyAttendanceDtrStatusOverride(
  baseAttendanceRow,
  "Absent"
);
assert.equal(
  computeGeneratedDtrLwopMinutes({
    undertimeMinutes: absentOverrideRow.undertimeMinutes,
    absentDays: absentOverrideRow.absentMinutes / 480,
  }),
  480,
  "Manual DTR Absent status should generate 8 LWOP hours."
);

console.log("DTR LWOP generation checks passed.");
