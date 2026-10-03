import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseAttendanceBuffer, summarizeEmployeeDay, type ParsedAttendanceLog } from "../lib/payroll/attendance";
import { buildAttendanceSummaryComputations } from "../lib/payroll/attendanceSync";
import { applyApprovedAttendanceCorrections, detectAttendanceCorrectionSuggestions } from "../lib/payroll/attendanceCorrections";

const scenarios = [
  { name: "day", date: "2026-09-10", start: "08:00:00", end: "17:00:00", overnight: false, pause: 60, minutes: 480 },
  { name: "overnight", date: "2026-09-10", start: "22:00:00", end: "06:00:00", overnight: true, pause: 0, minutes: 480 },
  { name: "host spring DST", date: "2026-03-07", start: "22:00:00", end: "06:00:00", overnight: true, pause: 0, minutes: 480 },
  { name: "host fall DST", date: "2026-10-31", start: "22:00:00", end: "06:00:00", overnight: true, pause: 0, minutes: 480 },
  { name: "host missing hour", date: "2026-03-08", start: "01:30:00", end: "03:30:00", overnight: false, pause: 0, minutes: 120 },
];

function verify() {
  let count = 0;
  for (const s of scenarios) {
    const nextDate = new Date(Date.parse(s.date + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
    const outDate = s.overnight ? nextDate : s.date;
    const shift = { checkInTime: s.start, checkOutTime: s.end, breakMinutes: s.pause, graceMinutes: 0, hoursPerDay: s.minutes / 60, restDay: null };
    for (const storage of ["CSV", "TXT", "database timestamp"] as const) {
      const text = ["EmployeeNo,DateTime,Direction,Device", `0001,${s.date} ${s.start},IN,B1`, `0001,${outDate} ${s.end},OUT,B2`].join("\n");
      const parsed = parseAttendanceBuffer(Buffer.from(text), storage === "TXT" ? "civil.txt" : "civil.csv");
      assert.equal(parsed.logs.length, 2);
      const logs: ParsedAttendanceLog[] = parsed.logs.map((log, index) => ({
        ...log, employeeId: "synthetic-person", rawLogId: index + 1,
        // PostgreSQL timestamp-without-timezone decoding differs from file parsing.
        ...(storage === "database timestamp" ? { loggedAt: new Date(`${log.logDate}T${log.logTime}Z`) } : {}),
      }));
      const before = JSON.stringify(logs);
      const summaries = buildAttendanceSummaryComputations({
        employees: [{ id: "synthetic-person", employeeNo: "0001", timekeeping: null }], logs,
        approvedLeaves: [], weeklyPatterns: [], shiftTableBreaksByShiftTableId: new Map(),
        shiftAssignments: [{ id: 1, employeeId: "synthetic-person", shiftTableId: null, shiftName: "Civil clock", shiftCode: "FIXED", shiftSchedule: "Morning", effectiveFrom: "2026-01-01", effectiveTo: null, ...shift, hoursPerDay: String(shift.hoursPerDay), paidBreakMinutes: 0, isFlexible: false, createdAt: new Date(), updatedAt: new Date() }],
        allowedAttendanceDateRange: { startDate: s.date, endDate: s.date },
      });
      assert.equal(summaries.length, 1);
      const summary = summaries[0];
      assert.equal(summary.workedMinutes, s.minutes, `${s.name}/${storage}`);
      assert.equal(summary.regularMinutes, s.minutes);
      assert.equal(summary.lateMinutes, 0);
      assert.equal(summary.undertimeMinutes, 0);
      assert.equal(summary.firstInAt?.toISOString(), logs[0].loggedAt.toISOString());
      assert.equal(summary.lastOutAt?.toISOString(), logs[1].loggedAt.toISOString());
      assert.equal(JSON.stringify(logs), before, "Calculation must preserve source timestamps");
      if (s.overnight) assert.equal(summary.nightMinutes, 480);
      if (s.name === "host missing hour") {
        const correctionShift = { ...shift, checkOutTime: "02:30:00", hoursPerDay: 1 };
        const incomplete = summarizeEmployeeDay(s.date, logs.slice(0, 1), correctionShift);
        const suggestion = detectAttendanceCorrectionSuggestions({ attendanceDate: s.date, logs: logs.slice(0, 1), shift: correctionShift, summary: incomplete }).find(r => r.correctionType === "Missing Out");
        assert.ok(suggestion);
        assert.equal(suggestion.payload.syntheticPunches[0].logTime, "02:30:00");
        assert.equal(summarizeEmployeeDay(s.date, applyApprovedAttendanceCorrections(logs.slice(0, 1), [suggestion]), correctionShift).workedMinutes, 60);
      }
      count++;
    }
  }
  console.log(`PASS ${process.env.TZ}: ${count} CSV/TXT/database clock and correction cases`);
}

if (process.argv.includes("--child")) verify();
else {
  for (const zone of ["UTC", "Asia/Manila", "America/New_York"]) {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", TZ: zone, TSX_DISABLE_CACHE: "1", PATH: path.dirname(process.execPath) };
    for (const key of ["SystemRoot", "WINDIR", "ComSpec", "SystemDrive", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"]) if (process.env[key] !== undefined) env[key] = process.env[key];
    const result = spawnSync(process.execPath, [...process.execArgv, path.resolve(process.argv[1]), "--child"], { env, encoding: "utf8", windowsHide: true, timeout: 120000 });
    process.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? "");
    assert.equal(result.status, 0, `Civil-time regression failed in ${zone}`);
  }
  console.log("Attendance civil-time checks passed: 45 cases; no connector or database required.");
}
