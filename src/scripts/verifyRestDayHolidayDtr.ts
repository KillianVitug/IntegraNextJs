import assert from "node:assert/strict";
import {
  getGeneratedDtrHolidayOvertimeCapacityMinutes,
  getGeneratedDtrHolidayWorkedMinutes,
  isGeneratedDtrHolidayCheckRequirementSatisfied,
} from "@/lib/payroll/generatedDtrHolidays";
import {
  buildHolidayCheckDateAssignments,
  buildHolidayCheckDateBackfillUpdates,
} from "@/lib/holidayCheckDates";
import { resolveOvertimeCategory } from "@/lib/payroll/overtime";
import { saveHolidayTypeAccountCodeSchema } from "@/zod-schemas/holidayTypeAccountCode";

const regularHolidayWorkday = {
  scheduledMinutes: 480,
  workedMinutes: 480,
  regularMinutes: 480,
  lateMinutes: 0,
  undertimeMinutes: 0,
  overtimeMinutes: 0,
  isRestDay: false,
};

assert.equal(
  getGeneratedDtrHolidayWorkedMinutes(regularHolidayWorkday),
  480,
  "Regular holiday workday should keep existing first-hours quantity."
);

const regularHolidayRestDay = {
  scheduledMinutes: 480,
  workedMinutes: 600,
  regularMinutes: 0,
  lateMinutes: 0,
  undertimeMinutes: 0,
  overtimeMinutes: 120,
  isRestDay: true,
};

assert.equal(
  getGeneratedDtrHolidayWorkedMinutes(regularHolidayRestDay),
  480,
  "Rest-day holiday work should generate first scheduled hours as holiday worked."
);
assert.equal(
  getGeneratedDtrHolidayOvertimeCapacityMinutes(regularHolidayRestDay),
  120,
  "Rest-day holiday work should keep explicit overtime minutes."
);
assert.equal(
  resolveOvertimeCategory({
    isRestDay: true,
    holidayType: "Regular",
  }),
  "REST_DAY_REGULAR_HOLIDAY",
  "Regular holiday rest-day OT should use the rest-day regular holiday category."
);

const specialHolidayRestDayWithoutExplicitOt = {
  scheduledMinutes: 480,
  workedMinutes: 540,
  regularMinutes: 0,
  lateMinutes: 0,
  undertimeMinutes: 0,
  overtimeMinutes: 0,
  isRestDay: true,
};

assert.equal(
  getGeneratedDtrHolidayWorkedMinutes(specialHolidayRestDayWithoutExplicitOt),
  480,
  "Rest-day holiday base hours should fall back to scheduled minutes."
);
assert.equal(
  getGeneratedDtrHolidayOvertimeCapacityMinutes(
    specialHolidayRestDayWithoutExplicitOt
  ),
  60,
  "Rest-day holiday excess worked minutes should be usable as OT capacity."
);
assert.equal(
  resolveOvertimeCategory({
    isRestDay: true,
    holidayType: "Company",
  }),
  "REST_DAY_SPECIAL_NON_WORKING_HOLIDAY",
  "Company holiday rest-day OT should follow special non-working rest-day category."
);

const parsedMapping = saveHolidayTypeAccountCodeSchema.parse({
  holidayType: "Regular",
  accountCodeId: 1,
  overtimeAccountCodeId: 2,
  restDayAccountCodeId: 3,
  restDayOvertimeAccountCodeId: 4,
});

assert.equal(parsedMapping.restDayAccountCodeId, 3);
assert.equal(parsedMapping.restDayOvertimeAccountCodeId, 4);

assert.deepEqual(
  buildHolidayCheckDateAssignments([
    { id: 1, holidayDate: "2026-04-09", holidayDate2: null },
  ]),
  [{ id: 1, checkDate1: "2026-04-08", checkDate2: "2026-04-10" }],
  "Single holidays should use adjacent before and after check dates."
);

assert.deepEqual(
  buildHolidayCheckDateAssignments([
    { id: 1, holidayDate: "2026-04-09", holidayDate2: null },
    { id: 2, holidayDate: "2026-04-10", holidayDate2: null },
  ]),
  [
    { id: 1, checkDate1: "2026-04-08", checkDate2: "2026-04-11" },
    { id: 2, checkDate1: "2026-04-08", checkDate2: "2026-04-11" },
  ],
  "Consecutive holidays should share before and after check dates."
);

assert.deepEqual(
  buildHolidayCheckDateAssignments([
    { id: 1, holidayDate: "2026-04-09", holidayDate2: "2026-04-11" },
  ]),
  [{ id: 1, checkDate1: "2026-04-08", checkDate2: "2026-04-12" }],
  "Multi-day holidays should use the range boundaries for check dates."
);

assert.deepEqual(
  buildHolidayCheckDateAssignments([
    { id: 1, holidayDate: "2026-01-01", holidayDate2: null },
  ]),
  [{ id: 1, checkDate1: "2025-12-31", checkDate2: "2026-01-02" }],
  "Holiday check dates can cross year boundaries."
);

assert.deepEqual(
  buildHolidayCheckDateBackfillUpdates([
    {
      id: 1,
      holidayDate: "2026-04-09",
      holidayDate2: null,
      checkDate1: "2026-04-07",
      checkDate2: null,
    },
    {
      id: 2,
      holidayDate: "2026-04-10",
      holidayDate2: null,
      checkDate1: "2026-04-08",
      checkDate2: "2026-04-11",
    },
  ]),
  [{ id: 1, checkDate2: "2026-04-11", requireCheckDate2: true }],
  "Backfill should fill blanks without overwriting manual check dates."
);

const checkDateAttendanceByDate = new Map([
  [
    "2026-04-08",
    {
      attendanceDate: "2026-04-08",
      workedMinutes: 480,
      regularMinutes: 480,
      lateMinutes: 0,
      undertimeMinutes: 0,
    },
  ],
  [
    "2026-04-10",
    {
      attendanceDate: "2026-04-10",
      workedMinutes: 480,
      regularMinutes: 480,
      lateMinutes: 30,
      undertimeMinutes: 0,
    },
  ],
]);

assert.equal(
  isGeneratedDtrHolidayCheckRequirementSatisfied({
    requirement: null,
    attendanceByDate: checkDateAttendanceByDate,
  }),
  true,
  "Holiday checks should not change existing behavior when no check date is required."
);

assert.equal(
  isGeneratedDtrHolidayCheckRequirementSatisfied({
    requirement: {
      checkDate1: "2026-04-08",
      checkDate2: null,
      requireCheckDate1: true,
      requireCheckDate2: false,
    },
    attendanceByDate: checkDateAttendanceByDate,
  }),
  true,
  "A required check date with 8 net worked hours should qualify."
);

assert.equal(
  isGeneratedDtrHolidayCheckRequirementSatisfied({
    requirement: {
      checkDate1: "2026-04-10",
      checkDate2: null,
      requireCheckDate1: true,
      requireCheckDate2: false,
    },
    attendanceByDate: checkDateAttendanceByDate,
  }),
  false,
  "A required check date below 8 net worked hours should not qualify."
);

assert.equal(
  isGeneratedDtrHolidayCheckRequirementSatisfied({
    requirement: {
      checkDate1: "2026-04-08",
      checkDate2: "2026-04-10",
      requireCheckDate1: true,
      requireCheckDate2: true,
    },
    attendanceByDate: checkDateAttendanceByDate,
  }),
  false,
  "Both required check dates must qualify."
);

assert.equal(
  isGeneratedDtrHolidayCheckRequirementSatisfied({
    requirement: {
      checkDate1: "2026-03-31",
      checkDate2: null,
      requireCheckDate1: true,
      requireCheckDate2: false,
    },
    attendanceByDate: new Map([
      [
        "2026-03-31",
        {
          attendanceDate: "2026-03-31",
          workedMinutes: 480,
          regularMinutes: 480,
          lateMinutes: 0,
          undertimeMinutes: 0,
        },
      ],
    ]),
  }),
  true,
  "A check date outside the holiday payroll period should still qualify from its own DTR row."
);

console.log("Rest-day holiday DTR checks passed.");
