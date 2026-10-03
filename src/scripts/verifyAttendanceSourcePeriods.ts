import assert from "node:assert/strict";
import { attendancePeriodUrl, selectAttendanceSourcePeriod, type AttendanceSourcePeriod } from "../lib/payroll/attendanceSourcePeriods";
import { attendanceSourceStartDate, assertAttendanceSourcePeriodAllowed } from "../lib/payroll/attendanceSourceRollout";

// Real failure shape: more than 120 seeded future periods pushed the current year out of the query.
const periods: AttendanceSourcePeriod[] = [];
for (let year = 2026; year <= 2036; year++) for (let month = 1; month <= 12; month++) for (const cycle of ["A", "B"]) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  periods.push({ id: `${prefix}-${cycle}`, code: `${prefix}-${cycle}`, year, startDate: `${prefix}-${cycle === "A" ? "01" : "16"}`, endDate: `${prefix}-${cycle === "A" ? "15" : "28"}` });
}
periods.push({ id: "test", code: "AT-TEST", year: 2026, startDate: "2026-09-29", endDate: "2026-09-29" });
const today = "2026-10-02";
const current = selectAttendanceSourcePeriod(periods, {}, today);
assert.equal(current.periodId, "2026-10-A");
assert.equal(current.periods.length, 25);
assert.ok(current.periods.some(p => p.id === "test"));
assert.equal(selectAttendanceSourcePeriod(periods, { periodId: "test", year: "2036" }, today).year, 2026);
assert.equal(selectAttendanceSourcePeriod(periods, { periodId: "test" }, today).periodId, "test");
assert.equal(selectAttendanceSourcePeriod(periods, { year: "2027" }, today).periodId, "2027-01-A");
assert.equal(selectAttendanceSourcePeriod(periods, { year: "2026" }, "2027-01-01").periodId, "2026-12-B");
assert.equal(selectAttendanceSourcePeriod(periods, { year: "broken", periodId: "missing" }, today).periodId, "2026-10-A");
assert.deepEqual(selectAttendanceSourcePeriod(periods, { year: "2025" }, today), { year: 2025, periods: [], periodId: "" });
assert.equal(selectAttendanceSourcePeriod([], {}, today).periodId, "");
const url = attendancePeriodUrl("/payroll/attendance-source", 2026, "test");
assert.equal(url, "/payroll/attendance-source?year=2026&periodId=test");
assert.equal(selectAttendanceSourcePeriod(periods, Object.fromEntries(new URL(url, "https://example.test").searchParams), today).periodId, "test");
assert.equal(attendancePeriodUrl("/payroll", 2026, "test"), "/payroll?year=2026&periodId=test");
console.log("Attendance period selection passed: future years, explicit links, invalid/empty selection and return navigation.");

assert.equal(attendanceSourceStartDate(""), null);
assert.equal(attendanceSourceStartDate(" 2026-10-01 "), "2026-10-01");
assert.equal(attendanceSourceStartDate("2028-02-29"), "2028-02-29");
for (const invalid of ["2026-02-29", "2026-10-32", "2026-13-01", "10/01/2026", "invalid"]) {
  assert.throws(() => attendanceSourceStartDate(invalid), /start date is invalid/);
}
assert.throws(() => assertAttendanceSourcePeriodAllowed("2026-09-16", "2026-10-01"), /earlier period retains/);
assert.doesNotThrow(() => assertAttendanceSourcePeriodAllowed("2026-10-01", "2026-10-01"));
assert.doesNotThrow(() => assertAttendanceSourcePeriodAllowed("2026-11-01", "2026-10-01"));
assert.doesNotThrow(() => assertAttendanceSourcePeriodAllowed("2026-09-16", null));
console.log("Attendance cutover checks passed: strict calendar dates, legacy opt-out, earlier-period rejection and future-period inclusion.");
