import assert from "node:assert/strict";
import {
  getMappedLeavePayrollAccountCode,
  normalizeLeavePayrollAccountKey,
} from "@/lib/payroll/leaveAccountCodes";
import { getManualPayrollBucketFromAccountCodeOrType } from "@/lib/payroll/manualPayrollBuckets";

type DayPart = "FullDay" | "AM" | "PM";

function getLeaveQuantityForDayPart(dayPart: DayPart) {
  return dayPart === "FullDay" ? 1 : 0.5;
}

function shouldChargeLeaveDay(args: {
  excludeRestDaysAndHolidays: boolean;
  isRestDay: boolean;
  holidayType: "Regular" | "Special Non-Working" | "Special Working" | "Company" | null;
}) {
  if (!args.excludeRestDaysAndHolidays) return true;
  if (args.isRestDay) return false;
  return (
    args.holidayType !== "Regular" &&
    args.holidayType !== "Special Non-Working" &&
    args.holidayType !== "Company"
  );
}

function getAnnualLeaveGrantQuantity(args: {
  leaveCode: string;
  annualEntitlement?: string | number | null;
  defaultSickLeave?: string | number | null;
  defaultVacationLeave?: string | number | null;
}) {
  if (args.leaveCode === "SL") return Number(args.defaultSickLeave ?? 0);
  if (args.leaveCode === "VL") return Number(args.defaultVacationLeave ?? 0);
  return Number(args.annualEntitlement ?? 0);
}

assert.equal(getAnnualLeaveGrantQuantity({
  leaveCode: "SL",
  defaultSickLeave: "5.00",
  defaultVacationLeave: "5.00",
}), 5);

assert.equal(getAnnualLeaveGrantQuantity({
  leaveCode: "VL",
  defaultSickLeave: "0.00",
  defaultVacationLeave: "0.00",
}), 0);

assert.equal(normalizeLeavePayrollAccountKey(" company   sick-leave "), "COMPANY SICK LEAVE");
assert.equal(
  getMappedLeavePayrollAccountCode({
    leaveType: "SL",
    leaveTypeLookup: null,
  }),
  "5-200"
);
assert.equal(
  getMappedLeavePayrollAccountCode({
    leaveType: null,
    leaveTypeLookup: {
      code: "ML",
      name: "Maternity Leave",
    } as never,
  }),
  "5-202"
);
assert.equal(
  getMappedLeavePayrollAccountCode({
    leaveType: "Paternity Leave",
    leaveTypeLookup: null,
  }),
  "5-203"
);
assert.equal(
  getMappedLeavePayrollAccountCode({
    leaveType: null,
    leaveTypeLookup: {
      code: "VL",
      name: "Company Vacation Leave",
    } as never,
  }),
  "5-204"
);
assert.equal(
  getMappedLeavePayrollAccountCode({
    leaveType: "Bereavement Leave",
    leaveTypeLookup: null,
  }),
  null
);
assert.equal(
  getManualPayrollBucketFromAccountCodeOrType({
    code: "1-101",
    accountType: "Overtime",
  }),
  "otPaidLeaves"
);
assert.equal(
  getManualPayrollBucketFromAccountCodeOrType({
    code: "2-201",
    accountType: "Other Income",
  }),
  "otPaidLeaves"
);
assert.equal(
  getManualPayrollBucketFromAccountCodeOrType({
    code: "3-999",
    accountType: "Other Income",
  }),
  "otherIncome"
);

assert.equal(getLeaveQuantityForDayPart("FullDay"), 1);
assert.equal(getLeaveQuantityForDayPart("AM"), 0.5);
assert.equal(getLeaveQuantityForDayPart("PM"), 0.5);

assert.equal(shouldChargeLeaveDay({
  excludeRestDaysAndHolidays: true,
  isRestDay: true,
  holidayType: null,
}), false);

assert.equal(shouldChargeLeaveDay({
  excludeRestDaysAndHolidays: true,
  isRestDay: false,
  holidayType: "Regular",
}), false);

assert.equal(shouldChargeLeaveDay({
  excludeRestDaysAndHolidays: true,
  isRestDay: false,
  holidayType: "Special Working",
}), true);

assert.equal(shouldChargeLeaveDay({
  excludeRestDaysAndHolidays: false,
  isRestDay: true,
  holidayType: "Company",
}), true);

console.log("Leave functionality fixtures passed.");
