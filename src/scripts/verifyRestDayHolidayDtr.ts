import assert from "node:assert/strict";
import {
  getGeneratedDtrHolidayOvertimeCapacityMinutes,
  getGeneratedDtrHolidayWorkedMinutes,
  isGeneratedDtrHolidayCheckRequirementSatisfied,
} from "@/lib/payroll/generatedDtrHolidays";
import {
  buildBranchCalendarOverrideRowsForGeneratedDtr,
  buildBranchCalendarOverrideScopeMaps,
  splitHeldDtrBranchCalendarApprovalMinutes,
} from "@/lib/payroll/branchCalendarAccountCodes";
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

const branchAccounts = new Map([
  [1, { id: 1, accountCode: "ALL-REG" }],
  [2, { id: 2, accountCode: "ALL-OT" }],
  [3, { id: 3, accountCode: "DEPT-REG" }],
  [4, { id: 4, accountCode: "DEPT-OT" }],
]);
const branchOverrideMaps = buildBranchCalendarOverrideScopeMaps([
  {
    attendanceDate: "2026-03-02",
    departmentId: null,
    regularAccountCodeId: 1,
    overtimeAccountCodeId: 2,
  },
  {
    attendanceDate: "2026-03-02",
    departmentId: 10,
    regularAccountCodeId: 3,
    overtimeAccountCodeId: 4,
  },
]);
const branchAttendanceRow = {
  attendanceDate: "2026-03-02",
  workedMinutes: 540,
  regularMinutes: 480,
  lateMinutes: 30,
  undertimeMinutes: 0,
  overtimeMinutes: 60,
  isRestDay: false,
};

const departmentBranchRows = buildBranchCalendarOverrideRowsForGeneratedDtr({
  rows: [branchAttendanceRow],
  departmentId: 10,
  overrideMaps: branchOverrideMaps,
  accountById: branchAccounts,
});

assert.equal(
  departmentBranchRows[0]?.regularAccount.accountCode,
  "DEPT-REG",
  "Department-specific branch calendar regular account should win over all-department."
);
assert.equal(
  departmentBranchRows[0]?.overtimeAccount.accountCode,
  "DEPT-OT",
  "Department-specific branch calendar overtime account should win over all-department."
);
assert.equal(
  departmentBranchRows[0]?.regularMinutes,
  450,
  "Branch calendar regular hours should use worked hours less late/undertime and replace the fallback REG bucket."
);
assert.equal(
  departmentBranchRows[0]?.overtimeMinutes,
  60,
  "Branch calendar overtime should keep overtime minutes for the selected overtime account."
);

const inheritedBranchRows = buildBranchCalendarOverrideRowsForGeneratedDtr({
  rows: [branchAttendanceRow],
  departmentId: 20,
  overrideMaps: branchOverrideMaps,
  accountById: branchAccounts,
});

assert.equal(
  inheritedBranchRows[0]?.regularAccount.accountCode,
  "ALL-REG",
  "All-department branch calendar account should apply when no department override exists."
);

const skippedHolidayBranchRows = buildBranchCalendarOverrideRowsForGeneratedDtr({
  rows: [branchAttendanceRow],
  departmentId: 10,
  overrideMaps: branchOverrideMaps,
  accountById: branchAccounts,
  isBranchCalendarDateEligible: () => false,
});

assert.equal(
  skippedHolidayBranchRows.length,
  0,
  "Branch calendar account codes should not apply to holiday/rest-day payroll rows."
);

const heldSplit = splitHeldDtrBranchCalendarApprovalMinutes({
  approvalRows: [
    {
      attendanceDate: "2026-03-02",
      workedMinutes: 480,
      overtimeMinutes: 60,
    },
    {
      attendanceDate: "2026-03-03",
      workedMinutes: 120,
      overtimeMinutes: 30,
    },
  ],
  departmentId: 10,
  overrideMaps: branchOverrideMaps,
  accountById: branchAccounts,
});

assert.equal(
  heldSplit.branchRows.length,
  1,
  "Held DTR approval should use branch calendar account codes for source dates with an override."
);
assert.equal(
  heldSplit.branchRows[0]?.attendanceDate,
  "2026-03-02",
  "Held DTR branch-calendar rows should preserve the original source attendance date."
);
assert.deepEqual(
  heldSplit.fallbackWorkedRows.map((row) => ({
    attendanceDate: row.attendanceDate,
    quantityMinutes: row.quantityMinutes,
  })),
  [{ attendanceDate: "2026-03-03", quantityMinutes: 120 }],
  "Held DTR worked minutes without a branch override should fall back to generic hold codes only for non-overridden minutes."
);
assert.deepEqual(
  heldSplit.fallbackOvertimeRows.map((row) => ({
    attendanceDate: row.attendanceDate,
    quantityMinutes: row.quantityMinutes,
  })),
  [{ attendanceDate: "2026-03-03", quantityMinutes: 30 }],
  "Held DTR overtime without a branch override should fall back to generic hold overtime only for non-overridden minutes."
);

console.log("Rest-day holiday DTR checks passed.");
