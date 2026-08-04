import assert from "node:assert/strict";
import {
  getMappedLeavePayrollAccountCode,
  normalizeLeavePayrollAccountKey,
} from "@/lib/payroll/leaveAccountCodes";
import {
  APPROVED_PAID_LEAVE_SOURCE_LABEL,
  buildApprovedPaidLeaveAccountCodeRows,
  buildManualPayrollLeaveAccountCodeRows,
} from "@/lib/payroll/manualLeaveAccountCodeRows";
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

const manualLeaveRows = buildManualPayrollLeaveAccountCodeRows({
  accountCodeOptions: [
    {
      id: 1,
      code: "5-200",
      accountType: "Paid Leaves",
      description: "Company Sick Leave",
      month13thPay: true,
      nonTaxable: false,
    },
    {
      id: 2,
      code: "OT-REG",
      accountType: "Overtime",
      description: "Regular OT",
      month13thPay: true,
      nonTaxable: false,
    },
    {
      id: 3,
      code: "U-LEAVE",
      accountType: "Unpaid Leaves/Absences",
      description: "Unpaid Leave",
      month13thPay: false,
      nonTaxable: true,
    },
    {
      id: 4,
      code: "9-999",
      accountType: "Paid Leaves",
      description: "Custom Paid Leave",
      month13thPay: true,
      nonTaxable: false,
    },
  ],
  lines: [
    {
      id: "leave-line-1",
      accountCodeId: 1,
      code: "5-200",
      description: "Paid Leave Compensation - Company Sick Leave",
      hours: 8,
      minutes: 0,
      amount: "500.00",
      sourceTable: "employees_leave_records",
      sortOrder: 0,
    },
    {
      id: "ot-line-1",
      accountCodeId: 2,
      code: "OT-REG",
      description: "Regular OT",
      hours: 1,
      minutes: 0,
      amount: "100.00",
      sourceTable: "attendance_daily_summaries",
      sortOrder: 1,
    },
    {
      id: "leave-line-2",
      accountCodeId: 2,
      code: "OT-REG",
      description: "Non-leave paid line",
      hours: 1,
      minutes: 0,
      amount: "100.00",
      sourceTable: "employees_leave_records",
      sortOrder: 2,
    },
  ],
});

assert.equal(manualLeaveRows.length, 1);
assert.equal(manualLeaveRows[0]?.accountCodeSnapshot, "5-200");
assert.equal(manualLeaveRows[0]?.accountTypeSnapshot, "Paid Leaves");
assert.equal(manualLeaveRows[0]?.hours, 8);
assert.equal(manualLeaveRows[0]?.amount, "500.00");
assert.equal(manualLeaveRows[0]?.sourceLabel, "Manual Payroll leave");

const approvedPaidLeaveRows = buildApprovedPaidLeaveAccountCodeRows({
  accountCodeOptions: [
    {
      id: 1,
      code: "5-204",
      accountType: "Paid Leaves",
      description: "Company Vacation Leave",
      month13thPay: true,
      nonTaxable: false,
    },
    {
      id: 2,
      code: "9-999",
      accountType: "Paid Leaves",
      description: "Custom Paid Leave",
      month13thPay: true,
      nonTaxable: false,
    },
    {
      id: 3,
      code: "U-LEAVE",
      accountType: "Unpaid Leaves/Absences",
      description: "Unpaid Leave",
      month13thPay: false,
      nonTaxable: true,
    },
  ],
  lines: [
    {
      accountCodeId: 1,
      code: "5-204",
      description: "Paid Leave (Audit Only) - Company Vacation Leave",
      hours: 8,
      minutes: 0,
      amount: "0.00",
      sourceTable: "employees_leave_records",
      sortOrder: 0,
    },
    {
      accountCodeId: 2,
      code: "9-999",
      description: "Paid Leave Compensation - Custom Paid Leave",
      hours: 4,
      minutes: 0,
      amount: "250.00",
      sourceTable: "employees_leave_records",
      sortOrder: 1,
    },
    {
      accountCodeId: 3,
      code: "U-LEAVE",
      description: "Unpaid Leave",
      hours: 8,
      minutes: 0,
      amount: "0.00",
      sourceTable: "employees_leave_records",
      sortOrder: 2,
    },
  ],
});

assert.equal(approvedPaidLeaveRows.length, 2);
assert.equal(approvedPaidLeaveRows[0]?.id, "approved-leave:0");
assert.equal(approvedPaidLeaveRows[0]?.accountCodeSnapshot, "5-204");
assert.equal(approvedPaidLeaveRows[0]?.amount, "0.00");
assert.equal(approvedPaidLeaveRows[0]?.sourceLabel, APPROVED_PAID_LEAVE_SOURCE_LABEL);
assert.equal(
  approvedPaidLeaveRows[0]?.sourceRemark,
  "Approved paid leave: Paid Leave (Audit Only) - Company Vacation Leave"
);
assert.equal(approvedPaidLeaveRows[1]?.accountCodeSnapshot, "9-999");
assert.equal(approvedPaidLeaveRows[1]?.amount, "250.00");
assert.equal(approvedPaidLeaveRows[1]?.hours, 4);

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
