import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  decimal,
  date,
  time,
  integer,
  jsonb,
  index,
  serial,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import {
  attendanceDtrDayTypeValues,
  attendanceDtrManualStatusValues,
} from "@/lib/payroll/dtrOverrides";
import {
  attendanceDtrCorrectionStatusValues,
  attendanceDtrCorrectionTypeValues,
  type AttendanceCorrectionPayload,
} from "@/lib/payroll/attendanceCorrections";
import { overtimeCategoryValues } from "@/lib/payroll/overtime";
import {
  payrollExceptionTypeValues,
  payrollExceptionWorkedStatusValues,
} from "@/lib/payroll/payrollExceptions";

//ENUMs - Fixed Values
export const categoryEnum = pgEnum("category", [
  "Daily",
  "Weekly",
  "Monthly",
  "Other",
]);
export const employmentStatusEnum = pgEnum("employment_status", [
  "Regular",
  "Probationary",
  "Contractual",
  "Finished Conctract",
  "Resigned",
  "Temporary",
  "Terminated",
]);
export const payrollModeEnum = pgEnum("payroll_mode", ["Bank", "Cash"]);
export const payrollTermsEnum = pgEnum("payroll_terms", [
  "Daily",
  "Weekly",
  "Bi-Weekly",
  "Semi-Monthly",
  "Monthly",
]);
export const confidentialityLevelEnum = pgEnum("confidentiality_level", [
  "Rank and File",
  "Supervisory",
  "Managerial",
]);
export const employeeTypeEnum = pgEnum("employee_type", ["EMP", "ADMIN"]);
export const authAccountStatusEnum = pgEnum("auth_account_status", [
  "PendingSetup",
  "Active",
  "Locked",
  "Disabled",
]);
export const authOtpPurposeEnum = pgEnum("auth_otp_purpose", [
  "Onboarding",
  "Login",
]);
export const taxStatusEnum = pgEnum("tax_status", [
  "S",
  "ME",
  "ME1-S1",
  "ME2-S2",
  "ME3-S3",
  "ME4-S4",
]);
export const civilStatusEnum = pgEnum("civil_status", ["Single", "Married"]);
export const genderEnum = pgEnum("gender", ["Male", "Female"]);
export const shiftScheduleEnum = pgEnum("shift_schedule", [
  "Morning",
  "Afternoon",
  "Night",
  "Other",
]);
export const shiftBreakSlotEnum = pgEnum("shift_break_slot", [
  "mid_break",
  "break_1",
  "break_2",
  "break_3",
  "break_4",
  "ot_break_1",
  "ot_break_2",
]);
export const restDayEnum = pgEnum("rest_day", [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]);
export const statusEnum = pgEnum("recurring_status", [
  "Active",
  "Paid",
  "Inactive",
]);
export const frequencyEnum = pgEnum("recurring_frequency", [
  "Once",
  "Daily",
  "Weekly",
  "Monthly",
  "Yearly",
  "Other",
]);
export const leaveTypeEnum = pgEnum("leave_type", ["SL", "VL"]);
export const leaveStatusEnum = pgEnum("leave_status", [
  "Pending",
  "Approved",
  "Denied",
  "Cancelled",
  "Voided",
]);
export const loanPaymentTermsEnum = pgEnum("loan_payment_terms", [
  "Always",
  "First Payroll",
  "Second Payroll",
  "Third Payroll",
  "Fourth Payroll",
]);
export const accountTypeEnum = pgEnum("account_type_enum", [
  "Regular Hours",
  "Overtime",
  "Night Premium",
  "Sunday/Holiday",
  "Paid Leaves",
  "Unpaid Leaves/Absences",
  "Other Income",
  "Loan",
  "Other Deduction",
]);
export const payrollExceptionDtrOverrideSourceEnum = pgEnum(
  "payroll_exception_dtr_override_source",
  [
    "DTR_WORKED",
    "DTR_TARDINESS",
    "DTR_UNDERTIME",
    "DTR_REGULAR_OVERTIME",
    "DTR_HOLD_WORKED",
    "DTR_HOLD_TARDINESS",
    "DTR_HOLD_UNDERTIME",
    "DTR_HOLD_REGULAR_OVERTIME",
  ]
);
export const loanStatusEnum = pgEnum("loan_status_enum", [
  "Active",
  "Paid",
  "Paid With Reloan",
  "Inactive",
]);

export const attendanceImportFormatEnum = pgEnum("attendance_import_format", [
  "CSV",
  "TXT",
]);

export const attendanceImportStatusEnum = pgEnum("attendance_import_status", [
  "Pending",
  "Processed",
  "Failed",
]);

export const attendanceLogDirectionEnum = pgEnum(
  "attendance_log_direction",
  ["IN", "OUT", "UNSPECIFIED"]
);

export const payrollPeriodCycleEnum = pgEnum("payroll_period_cycle", ["A", "B"]);

export const payrollPeriodStatusEnum = pgEnum("payroll_period_status", [
  "Open",
  "Closed",
  "Processed",
]);

export const payrollRunStatusEnum = pgEnum("payroll_run_status", [
  "Draft",
  "Stale",
  "Reviewed",
  "Approved",
  "Posted",
  "Void",
]);

export const payrollRunEventTypeEnum = pgEnum("payroll_run_event_type", [
  "Computed",
  "MarkedStale",
  "Reviewed",
  "Approved",
  "Posted",
  "Voided",
]);

export const payrollLineTypeEnum = pgEnum("payroll_line_type", [
  "Earning",
  "Deduction",
  "Employer Contribution",
  "Information",
]);

export const holidayTypeEnum = pgEnum("holiday_type_enum", [
  "Regular",
  "Special Non-Working",
  "Special Working",
  "Company",
]);

export const holidayTemplateRecurrenceEnum = pgEnum(
  "holiday_template_recurrence_enum",
  ["FixedDate", "NthWeekday", "ManualAnnual"]
);

export const holidayYearSourceEnum = pgEnum("holiday_year_source_enum", [
  "Generated",
  "Manual",
  "Backfill",
  "Package",
]);

export const holidayYearStatusEnum = pgEnum("holiday_year_status_enum", [
  "Draft",
  "Confirmed",
]);

export const overtimeCategoryEnum = pgEnum(
  "overtime_category_enum",
  overtimeCategoryValues
);

export const payrollExceptionTypeEnum = pgEnum(
  "payroll_exception_type",
  payrollExceptionTypeValues
);

export const payrollExceptionWorkedStatusEnum = pgEnum(
  "payroll_exception_worked_status",
  payrollExceptionWorkedStatusValues
);

export const attendanceDtrManualStatusEnum = pgEnum(
  "attendance_dtr_manual_status",
  attendanceDtrManualStatusValues
);

export const attendanceDtrCorrectionTypeEnum = pgEnum(
  "attendance_dtr_correction_type",
  attendanceDtrCorrectionTypeValues
);

export const attendanceDtrCorrectionStatusEnum = pgEnum(
  "attendance_dtr_correction_status",
  attendanceDtrCorrectionStatusValues
);

export const attendanceDtrDayTypeEnum = pgEnum(
  "attendance_dtr_day_type",
  attendanceDtrDayTypeValues
);

export const leaveLedgerTransactionEnum = pgEnum(
  "leave_ledger_transaction",
  [
    "Grant",
    "Accrual",
    "Adjustment",
    "Used",
    "Reversal",
    "Carryover",
    "Expiry",
    "Encashment",
  ]
);

export const leaveDayPartEnum = pgEnum("leave_day_part", [
  "FullDay",
  "AM",
  "PM",
]);

export const leaveApprovalEventActionEnum = pgEnum(
  "leave_approval_event_action",
  [
    "Submitted",
    "Updated",
    "Approved",
    "ApprovedWithOverride",
    "Denied",
    "Cancelled",
    "Voided",
  ]
);

export const leavePolicyGrantModelEnum = pgEnum("leave_policy_grant_model", [
  "Annual",
]);

export const leaveEncashmentStatusEnum = pgEnum("leave_encashment_status", [
  "Pending",
  "Approved",
  "Denied",
  "Void",
]);

export const loanInstallmentStatusEnum = pgEnum("loan_installment_status", [
  "Pending",
  "Due",
  "Paid",
  "Skipped",
  "Void",
]);

export const loanPaymentSourceEnum = pgEnum("loan_payment_source", [
  "Payroll",
  "Manual",
]);

export const statutoryRuleTypeEnum = pgEnum("statutory_rule_type", [
  "SSS",
  "PHILHEALTH",
  "PAGIBIG",
  "TAX",
]);

export const employeeFileTypeEnum = pgEnum("employee_file_type_enum", [
  "Admin",
  "Leave",
  "Performance",
  "Payroll",
  "Compliance",
  "Medical",
  "Training",
  "Travel",
  "Disciplinary",
  "Assets",
  "OffBoarding",
  "Other",
]);

export const basisOfComputationEnum = pgEnum("basis_of_computation", [
  "Gross Pay",
  "Actual Basic Pay",
  "Monthly Rate",
  "Fixed Monthly Salary",
  "Fixed Contribution",
]);

export const payrollScheduleEnum = pgEnum("payroll_schedule", [
  "Always",
  "First Payroll",
  "Second Payroll",
  "Third Payroll",
  "Fourth Payroll",
  "End Of Month",
]);

export const contributionTypeEnum = pgEnum("contribution_type", [
  "SSS",
  "PHILHEALTH",
  "PAGIBIG",
  "PERAA",
  "TAX",
]);

export const salaryChangeModeEnum = pgEnum("salary_change_mode", [
  "OnePeriodOverride",
  "ForwardEffective",
  "MultiPeriodOverride",
]);

export const salaryChangeStatusEnum = pgEnum("salary_change_status", [
  "Active",
  "Superseded",
  "Canceled",
  "AppliedPermanent",
]);

export const salaryChangeEventTypeEnum = pgEnum("salary_change_event_type", [
  "Created",
  "Superseded",
  "Canceled",
  "AppliedPermanent",
]);

export const managerScheduleRequestStatusEnum = pgEnum(
  "manager_schedule_request_status",
  ["Pending", "Approved", "Denied", "Cancelled", "Voided"]
);

export const managerScheduleRequestActionEnum = pgEnum(
  "manager_schedule_request_action",
  ["Create", "Update", "Delete"]
);

export const bankCodeTypeEnum = pgEnum("bank_code_type_enum", [
  "Philippine National Bank - (PNB)",
  "Asia United Bank - AUB",
  "Allied Bank - AB",
  "Bank of Commerce - BOC",
  "China Bank - CH",
  "East West Bank - EWB",
  "AsiaTrust Bank - AT",
  "Banco De Oro - BDO",
  "Bank Of The Philippine Islands - BPI",
  "ChinaTrust Bank - CH",
  "HSBC - HSBC",
  "Metro Bank - MB",
  "RCBC - RCBC (Current)",
  "RCBC - RCBC (Savings)",
  "Robinsons Saving Bank - RSB",
  "United Coconut Planters Bank - UCPB",
  "PBCOM - PBC",
  "Planters Development Bank - PB",
  "Security Bank - SB", 
  "Union Bank - UB",
])

// Lookup Tables
export const position = pgTable("position", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).unique().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const slvlGroup = pgTable("slvl_group", {
  id: integer("id").primaryKey(),
  name: varchar("name", { length: 50 }).unique().notNull(),
  defaultVacationLeave: decimal("default_vacation_leave", {
    precision: 5,
    scale: 2,
  })
    .default("0.00")
    .notNull(),
  defaultSickLeave: decimal("default_sick_leave", { precision: 5, scale: 2 })
    .default("0.00")
    .notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const department = pgTable("department", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).unique().notNull(),
  code: varchar("code", { length: 50 }).unique().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const accountCode = pgTable("accountCode", {
  id: serial("id").primaryKey(),
  accountType: accountTypeEnum("account_Type"),
  accountCode: varchar("account_Code", { length: 50 }).notNull(),
  description: varchar("description", { length: 80 }),
  dailyRate: decimal("daily_rate", { precision: 10, scale: 4 }),
  monthlyRate: decimal("monthly_rate", { precision: 10, scale: 4 }),
  month13thPay: boolean("month_13th_pay").notNull().default(false),
  nonTaxable: boolean("non_taxable").notNull().default(false),
  deminimis: boolean("deminimis").notNull().default(false),
  healthInsurance: boolean("health_insurance").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const branchCalendarAccountCodeOverrides = pgTable(
  "branch_calendar_account_code_overrides",
  {
    id: serial("id").primaryKey(),
    attendanceDate: date("attendance_date").notNull(),
    departmentId: integer("department_id").references(() => department.id, {
      onDelete: "cascade",
    }),
    regularAccountCodeId: integer("regular_account_code_id")
      .notNull()
      .references(() => accountCode.id, { onDelete: "restrict" }),
    overtimeAccountCodeId: integer("overtime_account_code_id")
      .notNull()
      .references(() => accountCode.id, { onDelete: "restrict" }),
    createdByUserId: varchar("created_by_user_id", { length: 255 }),
    updatedByUserId: varchar("updated_by_user_id", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_branch_calendar_account_codes_all_departments")
      .on(table.attendanceDate)
      .where(sql`${table.departmentId} is null`),
    uniqueIndex("uq_branch_calendar_account_codes_department")
      .on(table.attendanceDate, table.departmentId)
      .where(sql`${table.departmentId} is not null`),
    index("idx_branch_calendar_account_codes_date").on(table.attendanceDate),
    index("idx_branch_calendar_account_codes_department").on(table.departmentId),
    index("idx_branch_calendar_account_codes_regular").on(
      table.regularAccountCodeId
    ),
    index("idx_branch_calendar_account_codes_overtime").on(
      table.overtimeAccountCodeId
    ),
  ]
);

// Employees Table
export const employees = pgTable(
  "employees",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeType: employeeTypeEnum("employee_type").notNull().default("EMP"),
    employeeNo: varchar("employee_no", { length: 50 }).notNull(),
    firstName: varchar("first_name", { length: 50 }).notNull(),
    lastName: varchar("last_name", { length: 50 }).notNull(),
    middleName: varchar("middle_name", { length: 50 }),
    middleInitial: varchar("middle_initial", { length: 50 }),
    suffix: varchar("suffix", { length: 20 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("idx_employee_no").on(table.employeeNo),
    uniqueIndex("employees_employee_type_no_unique").on(
      table.employeeType,
      table.employeeNo,
    ),
  ]
);

// Employee General Info Table
export const employeesGeneralInfo = pgTable(
  "employees_general_info",
  {
    id: serial("id").primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" })
      .unique(),
    dateHired: date("date_hired"),
    separationDate: date("separation_date"),
    taxIdNumber: varchar("tax_id_number", { length: 20 }),
    sssNumber: varchar("sss_number", { length: 20 }),
    philhealthNumber: varchar("philhealth_number", { length: 20 }),
    payrollMode: payrollModeEnum("payroll_mode"),
    payrollTerms: payrollTermsEnum("payroll_terms"),
    category: categoryEnum("category"),
    departmentId: integer("department_id").references(() => department.id, {
      onDelete: "set null",
    }),
    employmentStatus: employmentStatusEnum("employment_status"),
    confidentialityLevel: confidentialityLevelEnum("confidentiality_level"),
    clearanceDate: date("clearance_date"),
    taxStatus: taxStatusEnum("tax_status"),
    perraIdNumber: varchar("perra_id_number", { length: 20 }),
    pagIbigNumber: varchar("perra_ibig_number", { length: 20 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("idx_general_employee_id").on(table.employeeId),
    index("idx_general_info_department_active").on(table.departmentId).where(sql`${table.deletedAt} is null`),
  ]
);

// Employee Salary Table
export const employeesSalary = pgTable(
  "employees_salary",
  {
    id: serial("id").primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" })
      .unique(),
    dailyRate: decimal("daily_rate", { precision: 10, scale: 4 }),
    monthlyRate: decimal("monthly_rate", { precision: 10, scale: 4 }),
    monthlyAllowance: decimal("monthly_allowance", { precision: 10, scale: 2 }),
    dailyAllowance: decimal("daily_allowance", { precision: 10, scale: 2 }),
    cola: decimal("cola", { precision: 10, scale: 2 }),
    rateDivisor: decimal("rate_divisor", { precision: 10, scale: 2 }),
    billingRate: decimal("billing_rate", { precision: 10, scale: 2 }),
    ignoreDtrForMonthlyRate: boolean("ignore_dtr_for_monthly_rate")
      .notNull()
      .default(false),
    ignoreContributionDeduction: boolean("ignore_contribution_deduction")
      .notNull()
      .default(false),
    customPayrollId: integer("custom_payroll_id")
    .references(() => customPayrollDefinitions.id, {
    onDelete: "set null",
  }),
    customPayrollDescription: text("custom_payroll_description"),
    slvlGroupId: integer("slvl_group_id").references(() => slvlGroup.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [index("idx_salary_employee_id").on(table.employeeId)]
);

// Employee Other References Table
export const employeesOtherReferences = pgTable(
  "employees_other_references",
  {
    id: serial("id").primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" })
      .unique(),
    bankCode: bankCodeTypeEnum("bank_code").default("Philippine National Bank - (PNB)"),
    bankAccountNo: varchar("bank_account_no", { length: 50 }),
    positionId: integer("position_id").references(() => position.id, {
      onDelete: "set null",
    }),
    address: text("address"),
    email: varchar("email", { length: 255 }),
    telephoneNo: varchar("telephone_no", { length: 20 }),
    birthday: date("birthday"),
    age: integer("age"),
    civilStatus: civilStatusEnum("civil_status"),
    gender: genderEnum("gender"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("idx_references_employee_id").on(table.employeeId),
    uniqueIndex("uq_employee_reference_email_active")
      .on(sql`lower(${table.email})`)
      .where(sql`${table.email} is not null and ${table.deletedAt} is null`),
  ]
);

// Employee Timekeeping Table (Partitioning by month for performance)
export const employeesTimekeeping = pgTable(
  "employees_timekeeping",
  {
    id: serial("id").primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" })
      .unique(),
    timekeepingId: varchar("timekeeping_id", { length: 50 }),
    shiftSchedule: shiftScheduleEnum("shift_schedule"),
    checkInTime: time("check_in_time"),
    checkOutTime: time("check_out_time"),
    restDay: restDayEnum("rest_day"),
    hoursWorked: decimal("hours_worked", { precision: 5, scale: 2 }),
    minutesWorked: decimal("minutes_worked", { precision: 5, scale: 2 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [index("idx_timekeeping_employee_id").on(table.employeeId)]
);

// Employee Recurring Entries Table
export const employeesRecurringEntries = pgTable(
  "employees_recurring_entries",
  {
    id: serial("id").primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    accountCode: varchar("account_code", { length: 50 }),
    description: text("description"),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    frequency: frequencyEnum("recurring_frequency"),
    status: statusEnum("recurring_status"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("idx_entries_employee_id").on(table.employeeId),
    index("idx_entries_employee_date_range").on(table.employeeId, table.startDate, table.endDate),
  ]
);

//EMPLOYEE RELATIONS
export const employeesRelations = relations(employees, ({ one, many }) => ({
  generalInfo: one(employeesGeneralInfo, {
    fields: [employees.id],
    references: [employeesGeneralInfo.employeeId],
  }),
  salary: one(employeesSalary, {
    fields: [employees.id],
    references: [employeesSalary.employeeId],
  }),
  otherReferences: one(employeesOtherReferences, {
    fields: [employees.id],
    references: [employeesOtherReferences.employeeId],
  }),
  timekeeping: one(employeesTimekeeping, {
    fields: [employees.id],
    references: [employeesTimekeeping.employeeId],
  }),
  recurringEntries: many(employeesRecurringEntries),

  leaveRecords: many(employeesLeaveRecords),

  salaryAdjudmentRecords: many(employeesSalaryAdjustments),
  salaryChanges: many(employeeSalaryChanges),

  loans: many(employeesLoans),

  folders: many(employeeFolders),
  weeklyShiftPatterns: many(employeeWeeklyShiftPatterns),
    shiftAssignments: many(employeeShiftAssignments),
    attendanceDailySummaries: many(attendanceDailySummaries),
    dailyOvertimeOverrides: many(employeeDailyOvertimeOverrides),
    payrollExceptionRows: many(employeePayrollExceptionRows),
    attendancePeriodOverrides: many(employeeAttendancePeriodOverrides),
    attendanceDayStatusOverrides: many(employeeAttendanceDayStatusOverrides),
    attendanceDayTypeOverrides: many(employeeAttendanceDayTypeOverrides),
    payrollRunEmployees: many(payrollRunEmployees),
    leaveBalanceLedger: many(leaveBalanceLedger),
    leaveEncashments: many(leaveEncashments),
  }));

//EMPLOYEE ENTRIES RELATION
export const employeesRecurringEntriesRelations = relations(
  employeesRecurringEntries,
  ({ one }) => ({
    employee: one(employees, {
      fields: [employeesRecurringEntries.employeeId],
      references: [employees.id],
    }),
  })
);

//SICK AND LEAVE TABLE
export const employeesLeaveRecords = pgTable(
  "employees_leave_records",
  {
    id: serial("id").primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: integer("leave_type_id").references(() => leaveTypes.id, {
      onDelete: "set null",
    }),
    dateFiled: date("date_filed").notNull(),
    leaveStartDate: date("leave_start_date"),
    leaveEndDate: date("leave_end_date"),
    leaveType: varchar("leave_type", { length: 20 }).notNull(),
    noOfDays: decimal("no_of_days", { precision: 4, scale: 2 }).notNull(),
    reason: text("reason"),
    leaveStatus: leaveStatusEnum("leave_status").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("idx_leave_record_employee_id").on(table.employeeId),
    index("idx_leave_record_date").on(table.dateFiled),
    index("idx_leave_record_employee_status_date").on(
      table.employeeId,
      table.leaveStatus,
      table.dateFiled
    ),
    index("idx_leave_record_status_active").on(table.leaveStatus).where(sql`${table.deletedAt} is null`),
  ]
);

export const employeeLeaveRecordDays = pgTable(
  "employee_leave_record_days",
  {
    id: serial("id").primaryKey(),
    leaveRecordId: integer("leave_record_id")
      .notNull()
      .references(() => employeesLeaveRecords.id, { onDelete: "cascade" }),
    leaveDate: date("leave_date").notNull(),
    dayPart: leaveDayPartEnum("day_part").notNull().default("FullDay"),
    quantity: decimal("quantity", { precision: 4, scale: 2 })
      .notNull()
      .default("0.00"),
    isRestDay: boolean("is_rest_day").notNull().default(false),
    holidayType: holidayTypeEnum("holiday_type"),
    exclusionReason: varchar("exclusion_reason", { length: 80 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_employee_leave_record_day").on(
      table.leaveRecordId,
      table.leaveDate
    ),
    index("idx_employee_leave_record_day_record").on(table.leaveRecordId),
    index("idx_employee_leave_record_day_date").on(table.leaveDate),
  ]
);

export const employeeLeaveApprovalEvents = pgTable(
  "employee_leave_approval_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leaveRecordId: integer("leave_record_id")
      .notNull()
      .references(() => employeesLeaveRecords.id, { onDelete: "cascade" }),
    actorUserId: varchar("actor_user_id", { length: 255 }),
    action: leaveApprovalEventActionEnum("action").notNull(),
    oldStatus: leaveStatusEnum("old_status"),
    newStatus: leaveStatusEnum("new_status"),
    decisionNote: text("decision_note"),
    overrideReason: text("override_reason"),
    balanceBefore: decimal("balance_before", { precision: 6, scale: 2 }),
    projectedBalance: decimal("projected_balance", { precision: 6, scale: 2 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_employee_leave_approval_event_record").on(table.leaveRecordId),
    index("idx_employee_leave_approval_event_actor").on(table.actorUserId),
  ]
);

//LEAVE RELATIONS
export const employeesLeaveRecordsRelations = relations(
  employeesLeaveRecords,
  ({ one, many }) => ({
    employee: one(employees, {
      fields: [employeesLeaveRecords.employeeId],
      references: [employees.id],
    }),
    leaveTypeLookup: one(leaveTypes, {
      fields: [employeesLeaveRecords.leaveTypeId],
      references: [leaveTypes.id],
    }),
    dayDetails: many(employeeLeaveRecordDays),
    approvalEvents: many(employeeLeaveApprovalEvents),
  })
);

export const employeeLeaveRecordDaysRelations = relations(
  employeeLeaveRecordDays,
  ({ one }) => ({
    leaveRecord: one(employeesLeaveRecords, {
      fields: [employeeLeaveRecordDays.leaveRecordId],
      references: [employeesLeaveRecords.id],
    }),
  })
);

export const employeeLeaveApprovalEventsRelations = relations(
  employeeLeaveApprovalEvents,
  ({ one }) => ({
    leaveRecord: one(employeesLeaveRecords, {
      fields: [employeeLeaveApprovalEvents.leaveRecordId],
      references: [employeesLeaveRecords.id],
    }),
  })
);

//SALARY ADJUSTMENT TABLE
export const employeesSalaryAdjustments = pgTable(
  "employees_salary_adjustments",
  {
    id: serial("id").primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    payrollCode: varchar("payroll_code", { length: 50 }).notNull(),
    oldDailyRate: decimal("old_daily_rate", { precision: 10, scale: 4 }),
    oldMonthlyRate: decimal("old_monthly_rate", { precision: 10, scale: 4 }),
    oldMonthlyAllowance: decimal("old_monthly_allowance", {
      precision: 10,
      scale: 2,
    }),
    oldDailyAllowance: decimal("old_daily_allowance", {
      precision: 10,
      scale: 2,
    }),
    oldRateDivisor: decimal("old_rate_divisor", { precision: 10, scale: 2 }),
    oldBillingRate: decimal("old_billing_rate", { precision: 10, scale: 2 }),
    newDailyRate: decimal("new_daily_rate", { precision: 10, scale: 4 }),
    newMonthlyRate: decimal("new_monthly_rate", { precision: 10, scale: 4 }),
    newMonthlyAllowance: decimal("new_monthly_allowance", {
      precision: 10,
      scale: 2,
    }),
    newDailyAllowance: decimal("new_daily_allowance", {
      precision: 10,
      scale: 2,
    }),
    newRateDivisor: decimal("new_rate_divisor", { precision: 10, scale: 2 }),
    newBillingRate: decimal("new_billing_rate", { precision: 10, scale: 2 }),
    adjustmentDate: timestamp("adjustment_date").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [index("idx_salary_adjustment_employee_id").on(table.employeeId)]
);

export const employeeSalaryChanges = pgTable(
  "employee_salary_changes",
  {
    id: serial("id").primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    payrollPeriodId: uuid("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    endPayrollPeriodId: uuid("end_payroll_period_id").references(
      () => payrollPeriods.id,
      { onDelete: "cascade" }
    ),
    mode: salaryChangeModeEnum("mode").notNull(),
    status: salaryChangeStatusEnum("status").notNull().default("Active"),
    reason: text("reason").notNull(),
    notes: text("notes"),
    createdByUserId: varchar("created_by_user_id", { length: 255 }).notNull(),
    beforeDailyRate: decimal("before_daily_rate", { precision: 10, scale: 4 }),
    beforeMonthlyRate: decimal("before_monthly_rate", { precision: 10, scale: 4 }),
    beforeMonthlyAllowance: decimal("before_monthly_allowance", {
      precision: 10,
      scale: 2,
    }),
    beforeDailyAllowance: decimal("before_daily_allowance", {
      precision: 10,
      scale: 2,
    }),
    beforeCola: decimal("before_cola", { precision: 10, scale: 2 }),
    beforeRateDivisor: decimal("before_rate_divisor", { precision: 10, scale: 2 }),
    beforeBillingRate: decimal("before_billing_rate", { precision: 10, scale: 2 }),
    afterDailyRate: decimal("after_daily_rate", { precision: 10, scale: 4 }),
    afterMonthlyRate: decimal("after_monthly_rate", { precision: 10, scale: 4 }),
    afterMonthlyAllowance: decimal("after_monthly_allowance", {
      precision: 10,
      scale: 2,
    }),
    afterDailyAllowance: decimal("after_daily_allowance", {
      precision: 10,
      scale: 2,
    }),
    afterCola: decimal("after_cola", { precision: 10, scale: 2 }),
    afterRateDivisor: decimal("after_rate_divisor", { precision: 10, scale: 2 }),
    afterBillingRate: decimal("after_billing_rate", { precision: 10, scale: 2 }),
    supersededAt: timestamp("superseded_at"),
    supersededByChangeId: integer("superseded_by_change_id"),
    canceledAt: timestamp("canceled_at"),
    canceledByUserId: varchar("canceled_by_user_id", { length: 255 }),
    cancelReason: text("cancel_reason"),
    appliedPermanentAt: timestamp("applied_permanent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_salary_change_employee_status_mode").on(
      table.employeeId,
      table.status,
      table.mode
    ),
    index("idx_salary_change_period_status").on(table.payrollPeriodId, table.status),
    index("idx_salary_change_end_period").on(table.endPayrollPeriodId),
    uniqueIndex("uq_salary_change_active_override").on(
      table.employeeId,
      table.payrollPeriodId
    ).where(
      sql`${table.status} = 'Active' and ${table.mode} = 'OnePeriodOverride'`
    ),
    uniqueIndex("uq_salary_change_active_forward").on(
      table.employeeId,
      table.payrollPeriodId
    ).where(
      sql`${table.status} = 'Active' and ${table.mode} = 'ForwardEffective'`
    ),
  ]
);

export const employeeSalaryChangeEvents = pgTable(
  "employee_salary_change_events",
  {
    id: serial("id").primaryKey(),
    changeId: integer("change_id")
      .notNull()
      .references(() => employeeSalaryChanges.id, { onDelete: "cascade" }),
    eventType: salaryChangeEventTypeEnum("event_type").notNull(),
    actorUserId: varchar("actor_user_id", { length: 255 }).notNull(),
    notes: text("notes"),
    eventAt: timestamp("event_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_salary_change_event_change_id").on(table.changeId),
    index("idx_salary_change_event_type").on(table.eventType),
  ]
);

//EMPLOYEE SALARY ADJUSTMENT RELATION
export const employeesSalaryAdjusmentRecordsRelations = relations(
  employeesSalaryAdjustments,
  ({ one }) => ({
    employee: one(employees, {
      fields: [employeesSalaryAdjustments.employeeId],
      references: [employees.id],
    }),
  })
);

// EMPLOYEE LOAN TABLE
export const employeesLoans = pgTable(
  "employees_loans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    accountCodeId: integer("account_Code").references(() => accountCode.id, {
      onDelete: "set null",
    }),
    loanReferenceNumber: varchar("loan_reference_number", {
      length: 120,
    }).notNull(),
    amountGranted: decimal("amount_granted", {
      precision: 10,
      scale: 2,
    }).notNull(),
    payrollDateDeduction: varchar("loan_payroll_deduction", {
      length: 50,
    }).notNull(),
    loanDate: date("loan_date").notNull(),
    paymentTerms: loanPaymentTermsEnum("loan_payment_terms").notNull(),
    termMonths: integer("term_months").notNull().default(1),
    payableLoan: varchar("payable_loan", { length: 50 }).notNull(),
    loanTotalCredit: decimal("loan_total_credit", {
      precision: 10,
      scale: 2,
    }).notNull(),
    amortization: varchar("amortization", { length: 50 }).notNull(),
    loanBalance: decimal("loan_balance", { precision: 10, scale: 2 }).notNull(),
    loanPaymentDate: date("loan_payment_date"),
    status: loanStatusEnum("loan_status_enum").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [index("idx_employee_id").on(table.employeeId)]
);

//EMPLYOEE LOAN RELATION
export const employeesLoansRelations = relations(employeesLoans, ({ one }) => ({
  employee: one(employees, {
    fields: [employeesLoans.employeeId],
    references: [employees.id],
  }),
}));

//EMPLOYEE FILES TABLE
export const employeeFiles = pgTable("employee_files", {
  id: uuid("id").defaultRandom().primaryKey(),

  groupId: uuid("group_id")
    .notNull()
    .references(() => employeeFolders.id, { onDelete: "cascade" }),

  // File Metadata
  fileName: varchar("file_name", { length: 255 }).notNull(),
  filePath: text("file_path").notNull(),
  fileExtension: varchar("file_extension", { length: 20 }),
  mimeType: varchar("mime_type", { length: 100 }),
  fileSize: integer("file_size"),

  // File-level description (can be same or unique per file)
  description: text("description"),
  remarks: text("remarks"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at"),
});

//EMPLOYEE FOLDER TABLE
export const employeeFolders = pgTable("employee_folder", {
  id: uuid("id").defaultRandom().primaryKey(),

  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),

  folderName: varchar("folder_name", { length: 100 }).notNull(),
  folderType: employeeFileTypeEnum("employee_file_type_enum").notNull(),
  description: text("description"),
  remarks: text("remarks"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at"),
});

//FOLDER/FILE RELATIONS
export const employeeFolderRelations = relations(
  employeeFolders,
  ({ one, many }) => ({
    employee: one(employees, {
      fields: [employeeFolders.employeeId],
      references: [employees.id],
    }),
    files: many(employeeFiles),
  })
);
export const employeeFilesRelations = relations(employeeFiles, ({ one }) => ({
  folder: one(employeeFolders, {
    fields: [employeeFiles.groupId],
    references: [employeeFolders.id],
  }),
}));

//CUSTOM PAYROLL GENERAL
export const customPayrollDefinitions = pgTable("custom_payroll_definitions", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  description: text("description"),

  // Salary Override
  rateDivisor: decimal("rate_divisor", { precision: 10, scale: 2 }),
  hourlyRateDivisor: decimal("hourly_rate_divisor", {
    precision: 10,
    scale: 2,
  }),

  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at"),
});

//CUSTOM PAYROLL CONTRIBUTION VALUES
export const employeeContributionGroups = pgTable(
  "employee_contribution_groups",
  {
    id: serial("id").primaryKey(),
    payrollCode: integer("payroll_code")
      .notNull()
      .references(() => customPayrollDefinitions.id, { onDelete: "cascade" }),
    contributionType: contributionTypeEnum("contribution_type").notNull(),
    /* RULES */
    // schedule: payrollScheduleEnum("schedule").notNull(),
    basisOfComputation: basisOfComputationEnum(
      "basis_of_computation"
    ).notNull(),
    /** Optional fixed basis amount. For example: fixed salary 20,000 */
    basisValue: decimal("basis_value", { precision: 10, scale: 2 }),
    /** For approximating next payroll in same month (default 100%) */
    approximationPercent: decimal("approximation_percent", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("100"),

      percentage: decimal("percentage", { precision: 5, scale: 4 }),   // e.g., 0.045 for 4.5%
      fixedAmount: decimal("fixed_amount", { precision: 10, scale: 2 }), // e.g., Php 100
      minimum: decimal("minimum", { precision: 10, scale: 2 }),
      maximum: decimal("maximum", { precision: 10, scale: 2 }),
    /** Fixed contribution values (optional per type) */
    fixedEmployeeShare: decimal("fixed_employee_share", {
      precision: 10,
      scale: 2,
    }).default("0"),
    fixedEmployerShare: decimal("fixed_employer_share", {
      precision: 10,
      scale: 2,
    }).default("0"),
    fixedECShare: decimal("fixed_ec_share", {
      precision: 10,
      scale: 2,
    }).default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  }
);

//CUSTOM PAYROLL BOOLEANS
export const employeeContributionFlags = pgTable(
  "employee_contribution_flags",
  {
    id: serial("id").primaryKey(),

    groupId: integer("group_id")
      .notNull()
      .unique()
      .references(() => employeeContributionGroups.id, {
        onDelete: "cascade",
      }),

    /* ===================== */
    /* PAYROLL SCHEDULE FLAGS */
    /* ===================== */
    scheduleAlways: boolean("schedule_always").notNull().default(true),
    scheduleEndOfMonth: boolean("schedule_end_of_month")
      .notNull()
      .default(false),
    scheduleFirstPayroll: boolean("schedule_first_payroll")
      .notNull()
      .default(false),
    scheduleSecondPayroll: boolean("schedule_second_payroll")
      .notNull()
      .default(false),
    scheduleThirdPayroll: boolean("schedule_third_payroll")
      .notNull()
      .default(false),
    scheduleForthPayroll: boolean("schedule_forth_payroll")
      .notNull()
      .default(false),

    /* ===================== */
    /* PAG-IBIG FLAGS */
    /* ===================== */
    pagibigMaxContribution: boolean("pagibig_max_contribution").default(false),
    pagibigDeductShare: boolean("pagibig_deduct_share").default(false),

    /* ===================== */
    /* PERAA FLAGS */
    /* ===================== */
    peraaComputeBoth: boolean("peraa_compute_both").default(false),
    peraaComputeEmployer: boolean("peraa_compute_employer").default(false),

    /* ===================== */
    /* TAX FLAGS */
    /* ===================== */
    taxFixedPercentage: boolean("tax_fixed_percentage").default(false),
    taxFixedValue: decimal("tax_fixed_value", { precision: 10, scale: 2 }),
    taxMonthEndAdjustment: boolean("tax_month_end_adjustment").default(false),

    /* ===================== */
    /* FUTURE FLAGS */
    /* ===================== */
    flag1: boolean("flag1"),
    flag2: boolean("flag2"),
    flag3: boolean("flag3"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  }
);

//Custom Payroll Employee Table
export const employeeCustomPayroll = pgTable("employee_custom_payroll", {
  id: serial("id").primaryKey(),
  employeeId: uuid("employee_id")
    .references(() => employees.id, { onDelete: "cascade" })
    .notNull(),
  customPayrollId: integer("custom_payroll_id")
    .references(() => customPayrollDefinitions.id, { onDelete: "restrict" })
    .notNull(),
  effectiveDate: date("effective_date"),
  endDate: date("end_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

//CUSTOM PAYROLL RELATIONS
export const customPayrollRelations = relations(
  customPayrollDefinitions,
  ({ many }) => ({
    contributionGroups: many(employeeContributionGroups),
    employeeAssignments: many(employeeCustomPayroll),
    payrollExceptionRows: many(employeePayrollExceptionRows),
  })
);

export const employeesSalaryRelations = relations(
  employeesSalary,
  ({ one }) => ({
    customPayroll: one(customPayrollDefinitions, {
      fields: [employeesSalary.customPayrollId],   // must be *_id
      references: [customPayrollDefinitions.id],   // must be id
    }),
  })
);
export const employeeContributionGroupsRelations = relations(
  employeeContributionGroups,
  ({ one }) => ({
    payroll: one(customPayrollDefinitions, {
      fields: [employeeContributionGroups.payrollCode],
      references: [customPayrollDefinitions.id],
    }),
    flags: one(employeeContributionFlags, {
      fields: [employeeContributionGroups.id],
      references: [employeeContributionFlags.groupId],
    }),
  })
);

export const employeeContributionFlagsRelations = relations(
  employeeContributionFlags,
  ({ one }) => ({
    group: one(employeeContributionGroups, {
      fields: [employeeContributionFlags.groupId],
      references: [employeeContributionGroups.id],
    }),
  })
);
export const employeeCustomPayrollRelations = relations(
  employeeCustomPayroll,
  ({ one }) => ({
    employee: one(employees, {
      fields: [employeeCustomPayroll.employeeId],
      references: [employees.id],
    }),
    customPayroll: one(customPayrollDefinitions, {
      fields: [employeeCustomPayroll.customPayrollId],
      references: [customPayrollDefinitions.id],
    }),
  })
);

export const employeeSalaryChangesRelations = relations(
  employeeSalaryChanges,
  ({ one, many }) => ({
    employee: one(employees, {
      fields: [employeeSalaryChanges.employeeId],
      references: [employees.id],
    }),
    payrollPeriod: one(payrollPeriods, {
      fields: [employeeSalaryChanges.payrollPeriodId],
      references: [payrollPeriods.id],
    }),
    endPayrollPeriod: one(payrollPeriods, {
      fields: [employeeSalaryChanges.endPayrollPeriodId],
      references: [payrollPeriods.id],
    }),
    events: many(employeeSalaryChangeEvents),
  })
);

export const employeeSalaryChangeEventsRelations = relations(
  employeeSalaryChangeEvents,
  ({ one }) => ({
    change: one(employeeSalaryChanges, {
      fields: [employeeSalaryChangeEvents.changeId],
      references: [employeeSalaryChanges.id],
    }),
  })
);

// SHIFT TABLE MASTER
export const shiftTables = pgTable(
  "shift_tables",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 40 }).notNull().unique(),
    description: varchar("description", { length: 120 }).notNull(),
    regularStartTime: time("regular_start_time").notNull(),
    regularEndTime: time("regular_end_time").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("uq_shift_table_code").on(table.code)]
);

export const shiftTableBreaks = pgTable(
  "shift_table_breaks",
  {
    id: serial("id").primaryKey(),
    shiftTableId: integer("shift_table_id")
      .notNull()
      .references(() => shiftTables.id, { onDelete: "cascade" }),
    slotKey: shiftBreakSlotEnum("slot_key").notNull(),
    label: varchar("label", { length: 80 }).notNull(),
    fromTime: time("from_time").notNull(),
    toTime: time("to_time").notNull(),
    deduct: boolean("deduct").notNull().default(false),
    deductHours: integer("deduct_hours").notNull().default(0),
    deductMinutes: integer("deduct_minutes").notNull().default(0),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_shift_table_break_shift_table_id").on(table.shiftTableId),
    uniqueIndex("uq_shift_table_break_slot").on(table.shiftTableId, table.slotKey),
  ]
);

export const employeeWeeklyShiftPatterns = pgTable(
  "employee_weekly_shift_patterns",
  {
    id: serial("id").primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_employee_weekly_pattern_employee_id").on(table.employeeId),
    index("idx_employee_weekly_pattern_effective_from").on(table.effectiveFrom),
    index("idx_employee_weekly_pattern_employee_effective_range").on(
      table.employeeId,
      table.effectiveFrom,
      table.effectiveTo
    ),
  ]
);

export const employeeWeeklyShiftPatternDays = pgTable(
  "employee_weekly_shift_pattern_days",
  {
    id: serial("id").primaryKey(),
    patternId: integer("pattern_id")
      .notNull()
      .references(() => employeeWeeklyShiftPatterns.id, { onDelete: "cascade" }),
    weekday: restDayEnum("weekday").notNull(),
    shiftTableId: integer("shift_table_id").references(() => shiftTables.id, {
      onDelete: "set null",
    }),
    shiftName: varchar("shift_name", { length: 80 }),
    shiftCode: varchar("shift_code", { length: 40 }),
    checkInTime: time("check_in_time"),
    checkOutTime: time("check_out_time"),
    breakMinutes: integer("break_minutes").notNull().default(0),
    paidBreakMinutes: integer("paid_break_minutes").notNull().default(0),
    hoursPerDay: decimal("hours_per_day", { precision: 5, scale: 2 })
      .notNull()
      .default("0.00"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_employee_weekly_pattern_day_pattern_id").on(table.patternId),
    index("idx_employee_weekly_pattern_day_shift_table_id").on(table.shiftTableId),
    uniqueIndex("uq_employee_weekly_pattern_day_weekday").on(table.patternId, table.weekday),
  ]
);

// SHIFT ASSIGNMENT MASTER
export const employeeShiftAssignments = pgTable(
  "employee_shift_assignments",
  {
    id: serial("id").primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    shiftTableId: integer("shift_table_id").references(() => shiftTables.id, {
      onDelete: "set null",
    }),
    shiftName: varchar("shift_name", { length: 80 }).notNull(),
    shiftCode: varchar("shift_code", { length: 40 }),
    shiftSchedule: shiftScheduleEnum("shift_schedule"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    checkInTime: time("check_in_time").notNull(),
    checkOutTime: time("check_out_time").notNull(),
    breakMinutes: integer("break_minutes").notNull().default(60),
    paidBreakMinutes: integer("paid_break_minutes").notNull().default(0),
    graceMinutes: integer("grace_minutes").notNull().default(0),
    restDay: restDayEnum("rest_day"),
    hoursPerDay: decimal("hours_per_day", { precision: 5, scale: 2 })
      .notNull()
      .default("8.00"),
    isFlexible: boolean("is_flexible").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_shift_assignment_employee_id").on(table.employeeId),
    index("idx_shift_assignment_shift_table_id").on(table.shiftTableId),
    index("idx_shift_assignment_effective_from").on(table.effectiveFrom),
    index("idx_shift_assignment_employee_effective_range").on(
      table.employeeId,
      table.effectiveFrom,
      table.effectiveTo
    ),
    index("idx_shift_assignment_active").on(table.employeeId, table.effectiveFrom).where(sql`${table.effectiveTo} is null`),
  ]
);

export type ManagerScheduleChangePayload = {
  id?: number;
  employeeId: string;
  shiftTableId: number;
  shiftSchedule?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  effectiveDates?: string[];
  appliedAssignmentIds?: number[];
  graceMinutes: number;
  restDay?: string | null;
  isFlexible: boolean;
};

export const managerScheduleChangeRequests = pgTable(
  "manager_schedule_change_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestedByAccountId: uuid("requested_by_account_id")
      .notNull()
      .references(() => authAccounts.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    targetAssignmentId: integer("target_assignment_id").references(
      () => employeeShiftAssignments.id,
      { onDelete: "set null" }
    ),
    action: managerScheduleRequestActionEnum("action").notNull(),
    status: managerScheduleRequestStatusEnum("status")
      .notNull()
      .default("Pending"),
    payload: jsonb("payload").$type<ManagerScheduleChangePayload>().notNull(),
    reason: text("reason"),
    decisionNote: text("decision_note"),
    decidedByAccountId: uuid("decided_by_account_id").references(
      () => authAccounts.id,
      { onDelete: "set null" }
    ),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_manager_schedule_request_requester").on(
      table.requestedByAccountId
    ),
    index("idx_manager_schedule_request_employee").on(table.employeeId),
    index("idx_manager_schedule_request_status").on(table.status),
    index("idx_manager_schedule_request_created_at").on(table.createdAt),
  ]
);

// PAYROLL PERIODS
export const payrollPeriods = pgTable(
  "payroll_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 20 }).notNull().unique(),
    payrollTerms: payrollTermsEnum("payroll_terms").notNull(),
    cycle: payrollPeriodCycleEnum("cycle").notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    nominalPayDate: date("nominal_pay_date").notNull(),
    adjustedPayDate: date("adjusted_pay_date").notNull(),
    status: payrollPeriodStatusEnum("status").notNull().default("Open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_payroll_period_year_month").on(table.year, table.month),
    index("idx_payroll_period_adjusted_pay_date").on(table.adjustedPayDate),
  ]
);

// ATTENDANCE IMPORT BATCHES
export const attendanceImportBatches = pgTable(
  "attendance_import_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payrollPeriodId: uuid("payroll_period_id").references(() => payrollPeriods.id, {
      onDelete: "set null",
    }),
    sourceFileName: varchar("source_file_name", { length: 255 }).notNull(),
    sourceFormat: attendanceImportFormatEnum("source_format").notNull(),
    sourceHash: varchar("source_hash", { length: 128 }),
    status: attendanceImportStatusEnum("status").notNull().default("Pending"),
    totalRows: integer("total_rows").notNull().default(0),
    matchedRows: integer("matched_rows").notNull().default(0),
    unmatchedRows: integer("unmatched_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    notes: text("notes"),
    importedAt: timestamp("imported_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_attendance_batch_payroll_period_id").on(table.payrollPeriodId),
    uniqueIndex("uq_attendance_batch_period_hash")
      .on(table.payrollPeriodId, table.sourceHash)
      .where(sql`${table.sourceHash} is not null`),
  ]
);

// RAW ATTENDANCE LOGS
export const attendanceRawLogs = pgTable(
  "attendance_raw_logs",
  {
    id: serial("id").primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => attendanceImportBatches.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    employeeNo: varchar("employee_no", { length: 50 }).notNull(),
    deviceId: varchar("device_id", { length: 80 }),
    siteCode: varchar("site_code", { length: 80 }),
    sourceLine: integer("source_line"),
    direction: attendanceLogDirectionEnum("direction")
      .notNull()
      .default("UNSPECIFIED"),
    loggedAt: timestamp("logged_at").notNull(),
    logDate: date("log_date").notNull(),
    logTime: time("log_time").notNull(),
    rawText: text("raw_text"),
    normalizedHash: varchar("normalized_hash", { length: 128 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_attendance_raw_logs_batch_id").on(table.batchId),
    index("idx_attendance_raw_logs_employee_id").on(table.employeeId),
    index("idx_attendance_raw_logs_log_date").on(table.logDate),
    index("idx_attendance_raw_logs_employee_log_date").on(table.employeeId, table.logDate),
    index("idx_attendance_raw_logs_normalized_hash").on(table.normalizedHash),
    index("idx_attendance_raw_logs_batch_date_employee_time").on(
      table.batchId,
      table.logDate,
      table.employeeId,
      table.loggedAt
    ),
  ]
);

// DAILY ATTENDANCE SUMMARIES
export const attendanceDailySummaries = pgTable(
  "attendance_daily_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    shiftAssignmentId: integer("shift_assignment_id").references(
      () => employeeShiftAssignments.id,
      { onDelete: "set null" }
    ),
    sourceBatchId: uuid("source_batch_id").references(
      () => attendanceImportBatches.id,
      { onDelete: "set null" }
    ),
    attendanceDate: date("attendance_date").notNull(),
    firstInAt: timestamp("first_in_at"),
    lastOutAt: timestamp("last_out_at"),
    scheduledInTime: time("scheduled_in_time"),
    scheduledOutTime: time("scheduled_out_time"),
    scheduledMinutes: integer("scheduled_minutes").notNull().default(0),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    regularMinutes: integer("regular_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    undertimeMinutes: integer("undertime_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    nightMinutes: integer("night_minutes").notNull().default(0),
    paidLeaveMinutes: integer("paid_leave_minutes").notNull().default(0),
    unpaidLeaveMinutes: integer("unpaid_leave_minutes").notNull().default(0),
    absentMinutes: integer("absent_minutes").notNull().default(0),
    isRestDay: boolean("is_rest_day").notNull().default(false),
    anomalyFlags: text("anomaly_flags"),
    remarks: text("remarks"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_attendance_daily_employee_date").on(
      table.employeeId,
      table.attendanceDate
    ),
  ]
);

export const attendanceDtrCorrections = pgTable(
  "attendance_dtr_corrections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payrollPeriodId: uuid("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    attendanceDate: date("attendance_date").notNull(),
    correctionType: attendanceDtrCorrectionTypeEnum("correction_type").notNull(),
    status: attendanceDtrCorrectionStatusEnum("status")
      .notNull()
      .default("Pending"),
    confidence: integer("confidence").notNull().default(0),
    reason: text("reason").notNull(),
    payload: jsonb("payload").$type<AttendanceCorrectionPayload>().notNull(),
    reviewedByUserId: varchar("reviewed_by_user_id", { length: 255 }),
    reviewedAt: timestamp("reviewed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_attendance_dtr_correction_day_type").on(
      table.payrollPeriodId,
      table.employeeId,
      table.attendanceDate,
      table.correctionType
    ),
    index("idx_attendance_dtr_correction_period_status").on(
      table.payrollPeriodId,
      table.status
    ),
    index("idx_attendance_dtr_correction_employee_date").on(
      table.employeeId,
      table.attendanceDate
    ),
  ]
);

export const attendanceDtrHoldApprovals = pgTable(
  "attendance_dtr_hold_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourcePayrollPeriodId: uuid("source_payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    targetPayrollPeriodId: uuid("target_payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    attendanceDate: date("attendance_date").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("Approved"),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    undertimeMinutes: integer("undertime_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    notes: text("notes"),
    approvedByUserId: varchar("approved_by_user_id", { length: 255 }),
    approvedAt: timestamp("approved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_attendance_dtr_hold_approval_day").on(
      table.sourcePayrollPeriodId,
      table.employeeId,
      table.attendanceDate
    ),
    index("idx_attendance_dtr_hold_approval_source").on(
      table.sourcePayrollPeriodId
    ),
    index("idx_attendance_dtr_hold_approval_target").on(
      table.targetPayrollPeriodId
    ),
    index("idx_attendance_dtr_hold_approval_employee_date").on(
      table.employeeId,
      table.attendanceDate
    ),
  ]
);

export const employeeAttendancePeriodOverrides = pgTable(
  "employee_attendance_period_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payrollPeriodId: uuid("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    presentDays: decimal("present_days", { precision: 6, scale: 2 }),
    workedMinutes: integer("worked_minutes"),
    lateMinutes: integer("late_minutes"),
    undertimeMinutes: integer("undertime_minutes"),
    overtimeMinutes: integer("overtime_minutes"),
    remarks: text("remarks"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_employee_attendance_period_override").on(
      table.payrollPeriodId,
      table.employeeId
    ),
    index("idx_employee_attendance_period_override_employee").on(table.employeeId),
  ]
);

export const employeeAttendanceDayStatusOverrides = pgTable(
  "employee_attendance_day_status_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payrollPeriodId: uuid("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    attendanceDate: date("attendance_date").notNull(),
    status: attendanceDtrManualStatusEnum("status").notNull(),
    remarks: text("remarks"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_employee_attendance_day_status_override").on(
      table.payrollPeriodId,
      table.employeeId,
      table.attendanceDate
    ),
    index("idx_employee_attendance_day_status_override_employee_date").on(
      table.employeeId,
      table.attendanceDate
    ),
  ]
);

export const employeeAttendanceDayTypeOverrides = pgTable(
  "employee_attendance_day_type_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payrollPeriodId: uuid("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    attendanceDate: date("attendance_date").notNull(),
    dayType: attendanceDtrDayTypeEnum("day_type").notNull(),
    remarks: text("remarks"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_employee_attendance_day_type_override").on(
      table.payrollPeriodId,
      table.employeeId,
      table.attendanceDate
    ),
    index("idx_employee_attendance_day_type_override_employee_date").on(
      table.employeeId,
      table.attendanceDate
    ),
  ]
);

// HOLIDAY CALENDAR
export const holidayCalendar = pgTable(
  "holiday_calendar",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 150 }).notNull(),
    holidayDate: date("holiday_date").notNull(),
    holidayDate2: date("holiday_date_2"),
    holidayType: holidayTypeEnum("holiday_type").notNull(),
    isPaid: boolean("is_paid").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("idx_holiday_calendar_date").on(table.holidayDate)]
);

export const holidayTemplates = pgTable(
  "holiday_templates",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 150 }).notNull(),
    holidayType: holidayTypeEnum("holiday_type").notNull(),
    isPaid: boolean("is_paid").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    recurrenceType: holidayTemplateRecurrenceEnum("recurrence_type")
      .notNull()
      .default("FixedDate"),
    fixedMonth: integer("fixed_month"),
    fixedDay: integer("fixed_day"),
    nthMonth: integer("nth_month"),
    nthWeekday: integer("nth_weekday"),
    nthOccurrence: integer("nth_occurrence"),
    durationDays: integer("duration_days").notNull().default(1),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_holiday_templates_active").on(table.isActive),
    index("idx_holiday_templates_name").on(table.name),
  ]
);

export const holidayYearCalendar = pgTable(
  "holiday_year_calendar",
  {
    id: serial("id").primaryKey(),
    year: integer("year").notNull(),
    templateId: integer("template_id").references(() => holidayTemplates.id, {
      onDelete: "set null",
    }),
    source: holidayYearSourceEnum("source").notNull().default("Manual"),
    name: varchar("name", { length: 150 }).notNull(),
    holidayDate: date("holiday_date"),
    holidayDate2: date("holiday_date_2"),
    checkDate1: date("check_date_1"),
    checkDate2: date("check_date_2"),
    requireCheckDate1: boolean("require_check_date_1")
      .notNull()
      .default(false),
    requireCheckDate2: boolean("require_check_date_2")
      .notNull()
      .default(false),
    holidayType: holidayTypeEnum("holiday_type").notNull(),
    isPaid: boolean("is_paid").notNull().default(true),
    status: holidayYearStatusEnum("status").notNull().default("Draft"),
    notes: text("notes"),
    generatedAt: timestamp("generated_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_holiday_year_calendar_year").on(table.year),
    index("idx_holiday_year_calendar_date").on(table.holidayDate),
    index("idx_holiday_year_calendar_status").on(table.status),
    uniqueIndex("uq_holiday_year_calendar_year_template")
      .on(table.year, table.templateId)
      .where(sql`${table.templateId} is not null`),
  ]
);

export const holidayTypeAccountCodes = pgTable(
  "holiday_type_account_codes",
  {
    id: serial("id").primaryKey(),
    holidayType: holidayTypeEnum("holiday_type").notNull(),
    accountCodeId: integer("account_code_id").references(() => accountCode.id, {
      onDelete: "set null",
    }),
    overtimeAccountCodeId: integer("overtime_account_code_id").references(
      () => accountCode.id,
      {
        onDelete: "set null",
      }
    ),
    restDayAccountCodeId: integer("rest_day_account_code_id").references(
      () => accountCode.id,
      {
        onDelete: "set null",
      }
    ),
    restDayOvertimeAccountCodeId: integer(
      "rest_day_overtime_account_code_id"
    ).references(() => accountCode.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_holiday_type_account_codes_type").on(table.holidayType),
    index("idx_holiday_type_account_codes_account").on(table.accountCodeId),
    index("idx_holiday_type_account_codes_overtime_account").on(
      table.overtimeAccountCodeId
    ),
    index("idx_holiday_type_account_codes_rest_day_account").on(
      table.restDayAccountCodeId
    ),
    index("idx_holiday_type_account_codes_rest_day_overtime_account").on(
      table.restDayOvertimeAccountCodeId
    ),
  ]
);

// LEAVE TYPES
export const leaveTypes = pgTable("leave_types", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  accountCodeId: integer("account_code_id").references(() => accountCode.id, {
    onDelete: "set null",
  }),
  isPaid: boolean("is_paid").notNull().default(true),
  requiresBalance: boolean("requires_balance").notNull().default(true),
  annualEntitlement: decimal("annual_entitlement", {
    precision: 5,
    scale: 2,
  })
    .notNull()
    .default("0.00"),
  colorHex: varchar("color_hex", { length: 20 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const leavePolicies = pgTable(
  "leave_policies",
  {
    id: serial("id").primaryKey(),
    leaveTypeId: integer("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" })
      .unique(),
    grantModel: leavePolicyGrantModelEnum("grant_model")
      .notNull()
      .default("Annual"),
    carryoverLimit: decimal("carryover_limit", { precision: 5, scale: 2 })
      .notNull()
      .default("0.00"),
    expiryMonth: integer("expiry_month").notNull().default(12),
    expiryDay: integer("expiry_day").notNull().default(31),
    encashmentEnabled: boolean("encashment_enabled").notNull().default(false),
    encashmentTaxable: boolean("encashment_taxable").notNull().default(true),
    encashmentMonth13thEligible: boolean("encashment_month_13th_eligible")
      .notNull()
      .default(false),
    encashmentAccountCodeId: integer("encashment_account_code_id").references(
      () => accountCode.id,
      { onDelete: "set null" }
    ),
    halfDayAllowed: boolean("half_day_allowed").notNull().default(true),
    excludeRestDaysAndHolidays: boolean("exclude_rest_days_and_holidays")
      .notNull()
      .default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_leave_policy_leave_type").on(table.leaveTypeId),
    index("idx_leave_policy_encashment_account").on(
      table.encashmentAccountCodeId
    ),
  ]
);

export const undertimeRules = pgTable(
  "undertime_rules",
  {
    id: serial("id").primaryKey(),
    minutesFrom: integer("minutes_from").notNull(),
    minutesTo: integer("minutes_to"),
    rateMultiplier: decimal("rate_multiplier", {
      precision: 8,
      scale: 4,
    }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("idx_undertime_rule_minutes_from").on(table.minutesFrom)]
);

export const overtimeRules = pgTable(
  "overtime_rules",
  {
    id: serial("id").primaryKey(),
    category: overtimeCategoryEnum("category").notNull(),
    minutesFrom: integer("minutes_from").notNull(),
    minutesTo: integer("minutes_to"),
    rateMultiplier: decimal("rate_multiplier", {
      precision: 8,
      scale: 4,
    }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_overtime_rule_category_minutes_from").on(
      table.category,
      table.minutesFrom
    ),
  ]
);

export const employeeDailyOvertimeOverrides = pgTable(
  "employee_daily_overtime_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    attendanceDate: date("attendance_date").notNull(),
    isApproved: boolean("is_approved").notNull().default(false),
    manualMinutes: integer("manual_minutes"),
    workedMinutesOverride: integer("worked_minutes_override"),
    category: overtimeCategoryEnum("category").notNull(),
    remarks: text("remarks"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_employee_daily_overtime_override").on(
      table.employeeId,
      table.attendanceDate
    ),
    index("idx_employee_daily_overtime_override_date").on(table.attendanceDate),
  ]
);

export const employeePayrollExceptionRows = pgTable(
  "employee_payroll_exception_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payrollPeriodId: uuid("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    attendanceDate: date("attendance_date").notNull(),
    exceptionType: payrollExceptionTypeEnum("exception_type"),
    workedStatus: payrollExceptionWorkedStatusEnum("worked_status"),
    dayType: attendanceDtrDayTypeEnum("day_type"),
    customPayrollCodeId: integer("custom_payroll_code_id").references(
      () => customPayrollDefinitions.id,
      { onDelete: "set null" }
    ),
    accountCodeId: integer("account_code_id").references(() => accountCode.id, {
      onDelete: "set null",
    }),
    accountCodeSnapshot: varchar("payroll_code_snapshot", {
      length: 50,
    }).notNull(),
    accountTypeSnapshot: accountTypeEnum("account_type_snapshot"),
    accountDescriptionSnapshot: varchar("account_description_snapshot", {
      length: 80,
    }),
    accountMonth13thPaySnapshot: boolean("account_month_13th_pay_snapshot")
      .notNull()
      .default(false),
    accountNonTaxableSnapshot: boolean("account_non_taxable_snapshot")
      .notNull()
      .default(false),
    overtimeCategory: overtimeCategoryEnum("overtime_category"),
    quantityMinutes: integer("quantity_minutes"),
    quantityDays: decimal("quantity_days", { precision: 6, scale: 2 }),
    amountOverride: decimal("amount_override", { precision: 12, scale: 2 }),
    remarks: text("remarks"),
    dtrOverrideSource: payrollExceptionDtrOverrideSourceEnum(
      "dtr_override_source"
    ),
    legacyOvertimeOverrideId: uuid("legacy_overtime_override_id").references(
      () => employeeDailyOvertimeOverrides.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_employee_payroll_exception_period_employee").on(
      table.payrollPeriodId,
      table.employeeId
    ),
    index("idx_employee_payroll_exception_period_id").on(table.payrollPeriodId),
    index("idx_employee_payroll_exception_account_code").on(table.accountCodeId),
    index("idx_employee_payroll_exception_date").on(table.attendanceDate),
    index("idx_employee_payroll_exception_dtr_override_source").on(
      table.dtrOverrideSource
    ),
  ]
);

export const tardinessRules = pgTable(
  "tardiness_rules",
  {
    id: serial("id").primaryKey(),
    minutesFrom: integer("minutes_from").notNull(),
    minutesTo: integer("minutes_to"),
    rateMultiplier: decimal("rate_multiplier", {
      precision: 8,
      scale: 4,
    }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("idx_tardiness_rule_minutes_from").on(table.minutesFrom)]
);

// LEAVE BALANCE LEDGER
export const leaveBalanceLedger = pgTable(
  "leave_balance_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: integer("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    transactionType: leaveLedgerTransactionEnum("transaction_type").notNull(),
    quantity: decimal("quantity", { precision: 5, scale: 2 }).notNull(),
    balanceAfter: decimal("balance_after", { precision: 5, scale: 2 }),
    periodYear: integer("period_year"),
    idempotencyKey: varchar("idempotency_key", { length: 140 }),
    sourceTable: varchar("source_table", { length: 50 }),
    sourceId: varchar("source_id", { length: 50 }),
    remarks: text("remarks"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_leave_ledger_employee_leave_type").on(
      table.employeeId,
      table.leaveTypeId
    ),
    index("idx_leave_ledger_employee_leave_type_year").on(
      table.employeeId,
      table.leaveTypeId,
      table.periodYear
    ),
    index("idx_leave_ledger_employee_transaction_year").on(
      table.employeeId,
      table.transactionType,
      table.periodYear
    ),
    uniqueIndex("uq_leave_ledger_idempotency_key")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
  ]
);

export const leaveEncashments = pgTable(
  "leave_encashments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: integer("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    payrollPeriodId: uuid("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    quantity: decimal("quantity", { precision: 5, scale: 2 }).notNull(),
    rate: decimal("rate", { precision: 12, scale: 2 }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    status: leaveEncashmentStatusEnum("status").notNull().default("Pending"),
    taxable: boolean("taxable").notNull().default(true),
    month13thEligible: boolean("month_13th_eligible").notNull().default(false),
    accountCodeId: integer("account_code_id").references(() => accountCode.id, {
      onDelete: "set null",
    }),
    requestedByUserId: varchar("requested_by_user_id", { length: 255 }),
    approvedByUserId: varchar("approved_by_user_id", { length: 255 }),
    approvedAt: timestamp("approved_at"),
    deniedByUserId: varchar("denied_by_user_id", { length: 255 }),
    deniedAt: timestamp("denied_at"),
    decisionNote: text("decision_note"),
    balanceBefore: decimal("balance_before", { precision: 6, scale: 2 }),
    projectedBalance: decimal("projected_balance", { precision: 6, scale: 2 }),
    manualPayrollEntryId: uuid("manual_payroll_entry_id").references(
      () => manualPayrollEntries.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_leave_encashment_employee").on(table.employeeId),
    index("idx_leave_encashment_leave_type").on(table.leaveTypeId),
    index("idx_leave_encashment_period").on(table.payrollPeriodId),
  ]
);

// LOAN INSTALLMENTS
export const loanInstallments = pgTable(
  "loan_installments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => employeesLoans.id, { onDelete: "cascade" }),
    payrollPeriodId: uuid("payroll_period_id").references(() => payrollPeriods.id, {
      onDelete: "set null",
    }),
    payrollCode: varchar("payroll_code", { length: 20 }).notNull(),
    installmentNo: integer("installment_no").notNull(),
    dueDate: date("due_date").notNull(),
    scheduledAmount: decimal("scheduled_amount", {
      precision: 10,
      scale: 2,
    }).notNull(),
    principalAmount: decimal("principal_amount", { precision: 10, scale: 2 }),
    interestAmount: decimal("interest_amount", { precision: 10, scale: 2 }),
    balanceAfter: decimal("balance_after", { precision: 10, scale: 2 }),
    status: loanInstallmentStatusEnum("status").notNull().default("Pending"),
    skippedAt: timestamp("skipped_at"),
    skippedByUserId: varchar("skipped_by_user_id", { length: 255 }),
    skipReason: text("skip_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_loan_installment_loan_id").on(table.loanId),
    index("idx_loan_installment_payroll_code").on(table.payrollCode),
    index("idx_loan_installment_code_status").on(
      table.payrollCode,
      table.status
    ),
  ]
);

// STATUTORY RULE VERSIONS
export const statutoryRuleVersions = pgTable(
  "statutory_rule_versions",
  {
    id: serial("id").primaryKey(),
    ruleType: statutoryRuleTypeEnum("rule_type").notNull(),
    code: varchar("code", { length: 50 }).notNull().unique(),
    description: text("description"),
    payrollTerms: payrollTermsEnum("payroll_terms").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_statutory_rule_type_effective").on(
      table.ruleType,
      table.effectiveFrom
    ),
  ]
);

export const sssContributionBrackets = pgTable(
  "sss_contribution_brackets",
  {
    id: serial("id").primaryKey(),
    versionId: integer("version_id")
      .notNull()
      .references(() => statutoryRuleVersions.id, { onDelete: "cascade" }),
    rangeFrom: decimal("range_from", { precision: 10, scale: 2 }).notNull(),
    rangeTo: decimal("range_to", { precision: 10, scale: 2 }).notNull(),
    salaryCredit: decimal("salary_credit", { precision: 10, scale: 2 })
      .notNull(),
    employeeShare: decimal("employee_share", { precision: 10, scale: 2 })
      .notNull(),
    employerShare: decimal("employer_share", { precision: 10, scale: 2 })
      .notNull(),
    ecShare: decimal("ec_share", { precision: 10, scale: 2 }).notNull(),
  },
  (table) => [index("idx_sss_contribution_version_id").on(table.versionId)]
);

export const philhealthContributionRates = pgTable(
  "philhealth_contribution_rates",
  {
    id: serial("id").primaryKey(),
    versionId: integer("version_id")
      .notNull()
      .references(() => statutoryRuleVersions.id, { onDelete: "cascade" }),
    monthlyBasicSalaryFloor: decimal("monthly_basic_salary_floor", {
      precision: 10,
      scale: 2,
    }).notNull(),
    monthlyBasicSalaryCeiling: decimal("monthly_basic_salary_ceiling", {
      precision: 10,
      scale: 2,
    }).notNull(),
    premiumRate: decimal("premium_rate", { precision: 7, scale: 6 }).notNull(),
    employeeShareRate: decimal("employee_share_rate", {
      precision: 7,
      scale: 6,
    }).notNull(),
    employerShareRate: decimal("employer_share_rate", {
      precision: 7,
      scale: 6,
    }).notNull(),
  },
  (table) => [index("idx_philhealth_contribution_version_id").on(table.versionId)]
);

export const pagibigContributionRates = pgTable(
  "pagibig_contribution_rates",
  {
    id: serial("id").primaryKey(),
    versionId: integer("version_id")
      .notNull()
      .references(() => statutoryRuleVersions.id, { onDelete: "cascade" }),
    rangeFrom: decimal("range_from", { precision: 10, scale: 2 }).notNull(),
    rangeTo: decimal("range_to", { precision: 10, scale: 2 }).notNull(),
    employeeRate: decimal("employee_rate", { precision: 7, scale: 6 }).notNull(),
    employerRate: decimal("employer_rate", { precision: 7, scale: 6 }).notNull(),
    maxCompensationBase: decimal("max_compensation_base", {
      precision: 10,
      scale: 2,
    }),
  },
  (table) => [index("idx_pagibig_contribution_version_id").on(table.versionId)]
);

export const birWithholdingTaxBrackets = pgTable(
  "bir_withholding_tax_brackets",
  {
    id: serial("id").primaryKey(),
    versionId: integer("version_id")
      .notNull()
      .references(() => statutoryRuleVersions.id, { onDelete: "cascade" }),
    payrollTerms: payrollTermsEnum("payroll_terms").notNull(),
    compensationFrom: decimal("compensation_from", {
      precision: 10,
      scale: 2,
    }).notNull(),
    compensationTo: decimal("compensation_to", { precision: 10, scale: 2 }),
    baseTax: decimal("base_tax", { precision: 10, scale: 2 }).notNull(),
    overPercentage: decimal("over_percentage", {
      precision: 7,
      scale: 6,
    }).notNull(),
  },
  (table) => [index("idx_bir_tax_bracket_version_id").on(table.versionId)]
);

// PAYROLL RUNS
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payrollPeriodId: uuid("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    status: payrollRunStatusEnum("status").notNull().default("Draft"),
    runNumber: integer("run_number").notNull().default(1),
    notes: text("notes"),
    computedAt: timestamp("computed_at"),
    computedByUserId: varchar("computed_by_user_id", { length: 255 }),
    reviewedAt: timestamp("reviewed_at"),
    reviewedByUserId: varchar("reviewed_by_user_id", { length: 255 }),
    approvedAt: timestamp("approved_at"),
    approvedByUserId: varchar("approved_by_user_id", { length: 255 }),
    postedAt: timestamp("posted_at"),
    postedByUserId: varchar("posted_by_user_id", { length: 255 }),
    voidedByUserId: varchar("voided_by_user_id", { length: 255 }),
    voidReason: text("void_reason"),
    reversalRunId: uuid("reversal_run_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("idx_payroll_run_period_id").on(table.payrollPeriodId)]
);

// PAYROLL RUN EMPLOYEES
export const payrollRunEmployees = pgTable(
  "payroll_run_employees",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payrollRunId: uuid("payroll_run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    employeeNoSnapshot: varchar("employee_no_snapshot", { length: 50 }).notNull(),
    employeeNameSnapshot: varchar("employee_name_snapshot", { length: 120 })
      .notNull(),
    salaryAdjustmentId: integer("salary_adjustment_id").references(
      () => employeeSalaryChanges.id,
      { onDelete: "set null" }
    ),
    salaryAdjustmentMode: salaryChangeModeEnum("salary_adjustment_mode"),
    regularPay: decimal("regular_pay", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    grossPay: decimal("gross_pay", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    taxablePay: decimal("taxable_pay", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    nonTaxablePay: decimal("non_taxable_pay", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    totalDeductions: decimal("total_deductions", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    employeeContributions: decimal("employee_contributions", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    employerContributions: decimal("employer_contributions", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    netPay: decimal("net_pay", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    breakdownNotes: text("breakdown_notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_payroll_run_employee_run_id").on(table.payrollRunId),
    index("idx_payroll_run_employee_employee_id").on(table.employeeId),
    index("idx_payroll_run_employee_run_employee").on(
      table.payrollRunId,
      table.employeeId
    ),
  ]
);

// PAYROLL RUN LINES
export const payrollRunLines = pgTable(
  "payroll_run_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payrollRunEmployeeId: uuid("payroll_run_employee_id")
      .notNull()
      .references(() => payrollRunEmployees.id, { onDelete: "cascade" }),
    lineType: payrollLineTypeEnum("line_type").notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    description: varchar("description", { length: 150 }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 2 }),
    rate: decimal("rate", { precision: 12, scale: 4 }),
    taxable: boolean("taxable").notNull().default(false),
    month13thEligible: boolean("month_13th_eligible").notNull().default(false),
    sourceTable: varchar("source_table", { length: 50 }),
    sourceId: varchar("source_id", { length: 50 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_payroll_run_line_employee_id").on(table.payrollRunEmployeeId),
    index("idx_payroll_run_line_employee_code").on(
      table.payrollRunEmployeeId,
      table.code
    ),
  ]
);

// MANUAL PAYROLL OVERRIDES
export const manualPayrollEntries = pgTable(
  "manual_payroll_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payrollPeriodId: uuid("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    employeeNoSnapshot: varchar("employee_no_snapshot", { length: 50 }).notNull(),
    employeeNameSnapshot: varchar("employee_name_snapshot", { length: 120 })
      .notNull(),
    payComputationMode: varchar("pay_computation_mode", { length: 20 }),
    baselineSnapshot: jsonb("baseline_snapshot"),
    regularPay: decimal("regular_pay", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    grossPay: decimal("gross_pay", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    taxablePay: decimal("taxable_pay", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    nonTaxablePay: decimal("non_taxable_pay", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    totalDeductions: decimal("total_deductions", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    employeeContributions: decimal("employee_contributions", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    employerContributions: decimal("employer_contributions", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    netPay: decimal("net_pay", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    sssEmployee: decimal("sss_employee", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    sssEmployer: decimal("sss_employer", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    sssEc: decimal("sss_ec", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    sssBasis: decimal("sss_basis", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    philhealthEmployee: decimal("philhealth_employee", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    philhealthEmployer: decimal("philhealth_employer", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    philhealthBasis: decimal("philhealth_basis", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    pagibigEmployee: decimal("pagibig_employee", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    pagibigEmployer: decimal("pagibig_employer", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    pagibigBasis: decimal("pagibig_basis", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    withholdingTax: decimal("withholding_tax", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    withholdingTaxBasis: decimal("withholding_tax_basis", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    peraaEmployee: decimal("peraa_employee", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    peraaEmployer: decimal("peraa_employer", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    peraaBasis: decimal("peraa_basis", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    remarks: text("remarks"),
    createdByUserId: varchar("created_by_user_id", { length: 255 }),
    updatedByUserId: varchar("updated_by_user_id", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_manual_payroll_entry_period_employee").on(
      table.payrollPeriodId,
      table.employeeId
    ),
    index("idx_manual_payroll_entry_period").on(table.payrollPeriodId),
    index("idx_manual_payroll_entry_employee").on(table.employeeId),
  ]
);

export const manualPayrollEntryLines = pgTable(
  "manual_payroll_entry_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    manualPayrollEntryId: uuid("manual_payroll_entry_id")
      .notNull()
      .references(() => manualPayrollEntries.id, { onDelete: "cascade" }),
    accountCodeId: integer("account_code_id").references(() => accountCode.id, {
      onDelete: "set null",
    }),
    lineType: payrollLineTypeEnum("line_type").notNull(),
    summaryBucket: varchar("summary_bucket", { length: 40 }).notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    description: varchar("description", { length: 150 }).notNull(),
    loanRefNo: varchar("loan_ref_no", { length: 80 }),
    hours: integer("hours").notNull().default(0),
    minutes: integer("minutes").notNull().default(0),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    taxable: boolean("taxable").notNull().default(false),
    month13thEligible: boolean("month_13th_eligible").notNull().default(false),
    nonTaxable: boolean("non_taxable").notNull().default(false),
    deminimis: boolean("deminimis").notNull().default(false),
    sourceTable: varchar("source_table", { length: 50 }),
    sourceId: varchar("source_id", { length: 50 }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_manual_payroll_entry_line_entry").on(table.manualPayrollEntryId),
    index("idx_manual_payroll_entry_line_account").on(table.accountCodeId),
  ]
);

// LOAN PAYMENTS
export const loanPayments = pgTable(
  "loan_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => employeesLoans.id, { onDelete: "cascade" }),
    installmentId: uuid("installment_id").references(() => loanInstallments.id, {
      onDelete: "set null",
    }),
    payrollRunEmployeeId: uuid("payroll_run_employee_id").references(
      () => payrollRunEmployees.id,
      { onDelete: "set null" }
    ),
    paymentDate: date("payment_date").notNull(),
    amountPaid: decimal("amount_paid", { precision: 10, scale: 2 }).notNull(),
    source: loanPaymentSourceEnum("source").notNull().default("Payroll"),
    remarks: text("remarks"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_loan_payment_loan_id").on(table.loanId),
    uniqueIndex("uq_loan_payment_payroll_installment")
      .on(table.installmentId, table.source)
      .where(sql`${table.installmentId} is not null and ${table.source} = 'Payroll'`),
  ]
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" })
      .unique(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash"),
    status: authAccountStatusEnum("status").notNull().default("PendingSetup"),
    mustSetPassword: boolean("must_set_password").notNull().default(true),
    lastLoginAt: timestamp("last_login_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_auth_accounts_status").on(table.status),
    index("idx_auth_accounts_employee_id").on(table.employeeId),
    uniqueIndex("uq_auth_accounts_email_lower").on(sql`lower(${table.email})`),
  ]
);

export const authPermissionGroups = pgTable(
  "auth_permission_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: varchar("key", { length: 80 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_auth_permission_groups_key").on(table.key),
  ],
);

export const authAccountPermissionGroups = pgTable(
  "auth_account_permission_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => authAccounts.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => authPermissionGroups.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_auth_account_permission_groups_account_id").on(table.accountId),
    index("idx_auth_account_permission_groups_group_id").on(table.groupId),
    uniqueIndex("uq_auth_account_permission_group").on(
      table.accountId,
      table.groupId,
    ),
  ],
);

export const authManagerDepartments = pgTable(
  "auth_manager_departments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => authAccounts.id, { onDelete: "cascade" }),
    departmentId: integer("department_id")
      .notNull()
      .references(() => department.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_auth_manager_departments_account_id").on(table.accountId),
    index("idx_auth_manager_departments_department_id").on(table.departmentId),
    uniqueIndex("uq_auth_manager_department").on(
      table.accountId,
      table.departmentId,
    ),
  ],
);

export const authEmailOtps = pgTable(
  "auth_email_otps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => authAccounts.id, { onDelete: "cascade" }),
    purpose: authOtpPurposeEnum("purpose").notNull(),
    otpHash: varchar("otp_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_auth_email_otps_account_id").on(table.accountId),
    index("idx_auth_email_otps_purpose").on(table.purpose),
  ]
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => authAccounts.id, { onDelete: "cascade" }),
    sessionTokenHash: varchar("session_token_hash", { length: 64 })
      .notNull()
      .unique(),
    expiresAt: timestamp("expires_at").notNull(),
    lastSeenAt: timestamp("last_seen_at"),
    revokedAt: timestamp("revoked_at"),
    ipAddress: varchar("ip_address", { length: 100 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_auth_sessions_account_id").on(table.accountId),
    index("idx_auth_sessions_expires_at").on(table.expiresAt),
  ]
);

export const authAdminInvites = pgTable(
  "auth_admin_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    inviteTokenHash: varchar("invite_token_hash", { length: 64 })
      .notNull()
      .unique(),
    confidentialityLevel: confidentialityLevelEnum("confidentiality_level").notNull(),
    invitedByAccountId: uuid("invited_by_account_id").references(() => authAccounts.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_auth_admin_invites_email").on(table.email),
    index("idx_auth_admin_invites_expires_at").on(table.expiresAt),
  ]
);

export const authPasswordSetupTokens = pgTable(
  "auth_password_setup_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => authAccounts.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_auth_password_setup_tokens_account_id").on(table.accountId)]
);

export const authTemporaryPasswordReveals = pgTable(
  "auth_temporary_password_reveals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => authAccounts.id, { onDelete: "cascade" }),
    encryptedPassword: text("encrypted_password").notNull(),
    iv: varchar("iv", { length: 32 }).notNull(),
    authTag: varchar("auth_tag", { length: 32 }).notNull(),
    purpose: varchar("purpose", { length: 80 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revealedAt: timestamp("revealed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_auth_temporary_password_reveals_account_id").on(table.accountId),
    index("idx_auth_temporary_password_reveals_expires_at").on(table.expiresAt),
  ],
);

export const adminAuditEvents = pgTable(
  "admin_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: varchar("actor_user_id", { length: 255 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: varchar("entity_id", { length: 255 }),
    action: varchar("action", { length: 120 }).notNull(),
    details: text("details"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_admin_audit_created_at").on(table.createdAt),
    index("idx_admin_audit_entity").on(table.entityType, table.entityId),
  ]
);

export const payrollRunEvents = pgTable(
  "payroll_run_events",
  {
    id: serial("id").primaryKey(),
    payrollRunId: uuid("payroll_run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    eventType: payrollRunEventTypeEnum("event_type").notNull(),
    fromStatus: payrollRunStatusEnum("from_status"),
    toStatus: payrollRunStatusEnum("to_status"),
    actorUserId: varchar("actor_user_id", { length: 255 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_payroll_run_event_run_id").on(table.payrollRunId),
    index("idx_payroll_run_event_type").on(table.eventType),
  ]
);

// NEW RELATIONS
export const shiftTablesRelations = relations(shiftTables, ({ many }) => ({
  breaks: many(shiftTableBreaks),
  weeklyPatternDays: many(employeeWeeklyShiftPatternDays),
  assignments: many(employeeShiftAssignments),
}));

export const shiftTableBreaksRelations = relations(shiftTableBreaks, ({ one }) => ({
  shiftTable: one(shiftTables, {
    fields: [shiftTableBreaks.shiftTableId],
    references: [shiftTables.id],
  }),
}));

export const employeeWeeklyShiftPatternsRelations = relations(
  employeeWeeklyShiftPatterns,
  ({ one, many }) => ({
    employee: one(employees, {
      fields: [employeeWeeklyShiftPatterns.employeeId],
      references: [employees.id],
    }),
    days: many(employeeWeeklyShiftPatternDays),
  })
);

export const employeeWeeklyShiftPatternDaysRelations = relations(
  employeeWeeklyShiftPatternDays,
  ({ one }) => ({
    pattern: one(employeeWeeklyShiftPatterns, {
      fields: [employeeWeeklyShiftPatternDays.patternId],
      references: [employeeWeeklyShiftPatterns.id],
    }),
    shiftTable: one(shiftTables, {
      fields: [employeeWeeklyShiftPatternDays.shiftTableId],
      references: [shiftTables.id],
    }),
  })
);

export const employeeShiftAssignmentsRelations = relations(
  employeeShiftAssignments,
  ({ one }) => ({
    employee: one(employees, {
      fields: [employeeShiftAssignments.employeeId],
      references: [employees.id],
    }),
    shiftTable: one(shiftTables, {
      fields: [employeeShiftAssignments.shiftTableId],
      references: [shiftTables.id],
    }),
  })
);

export const attendanceImportBatchesRelations = relations(
  attendanceImportBatches,
  ({ one, many }) => ({
    payrollPeriod: one(payrollPeriods, {
      fields: [attendanceImportBatches.payrollPeriodId],
      references: [payrollPeriods.id],
    }),
    rawLogs: many(attendanceRawLogs),
  })
);

export const attendanceRawLogsRelations = relations(
  attendanceRawLogs,
  ({ one }) => ({
    batch: one(attendanceImportBatches, {
      fields: [attendanceRawLogs.batchId],
      references: [attendanceImportBatches.id],
    }),
    employee: one(employees, {
      fields: [attendanceRawLogs.employeeId],
      references: [employees.id],
    }),
  })
);

export const attendanceDailySummariesRelations = relations(
  attendanceDailySummaries,
  ({ one }) => ({
    employee: one(employees, {
      fields: [attendanceDailySummaries.employeeId],
      references: [employees.id],
    }),
    shiftAssignment: one(employeeShiftAssignments, {
      fields: [attendanceDailySummaries.shiftAssignmentId],
      references: [employeeShiftAssignments.id],
    }),
    sourceBatch: one(attendanceImportBatches, {
      fields: [attendanceDailySummaries.sourceBatchId],
      references: [attendanceImportBatches.id],
    }),
  })
);

export const employeeAttendancePeriodOverridesRelations = relations(
  employeeAttendancePeriodOverrides,
  ({ one }) => ({
    payrollPeriod: one(payrollPeriods, {
      fields: [employeeAttendancePeriodOverrides.payrollPeriodId],
      references: [payrollPeriods.id],
    }),
    employee: one(employees, {
      fields: [employeeAttendancePeriodOverrides.employeeId],
      references: [employees.id],
    }),
  })
);

export const employeeAttendanceDayStatusOverridesRelations = relations(
  employeeAttendanceDayStatusOverrides,
  ({ one }) => ({
    payrollPeriod: one(payrollPeriods, {
      fields: [employeeAttendanceDayStatusOverrides.payrollPeriodId],
      references: [payrollPeriods.id],
    }),
    employee: one(employees, {
      fields: [employeeAttendanceDayStatusOverrides.employeeId],
      references: [employees.id],
    }),
  })
);

export const employeeAttendanceDayTypeOverridesRelations = relations(
  employeeAttendanceDayTypeOverrides,
  ({ one }) => ({
    payrollPeriod: one(payrollPeriods, {
      fields: [employeeAttendanceDayTypeOverrides.payrollPeriodId],
      references: [payrollPeriods.id],
    }),
    employee: one(employees, {
      fields: [employeeAttendanceDayTypeOverrides.employeeId],
      references: [employees.id],
    }),
  })
);

export const employeeDailyOvertimeOverridesRelations = relations(
  employeeDailyOvertimeOverrides,
  ({ one }) => ({
    employee: one(employees, {
      fields: [employeeDailyOvertimeOverrides.employeeId],
      references: [employees.id],
    }),
  })
);

export const employeePayrollExceptionRowsRelations = relations(
  employeePayrollExceptionRows,
  ({ one }) => ({
    payrollPeriod: one(payrollPeriods, {
      fields: [employeePayrollExceptionRows.payrollPeriodId],
      references: [payrollPeriods.id],
    }),
    employee: one(employees, {
      fields: [employeePayrollExceptionRows.employeeId],
      references: [employees.id],
    }),
    customPayrollCode: one(customPayrollDefinitions, {
      fields: [employeePayrollExceptionRows.customPayrollCodeId],
      references: [customPayrollDefinitions.id],
    }),
    accountCode: one(accountCode, {
      fields: [employeePayrollExceptionRows.accountCodeId],
      references: [accountCode.id],
    }),
    legacyOvertimeOverride: one(employeeDailyOvertimeOverrides, {
      fields: [employeePayrollExceptionRows.legacyOvertimeOverrideId],
      references: [employeeDailyOvertimeOverrides.id],
    }),
  })
);

export const leaveTypesRelations = relations(leaveTypes, ({ many, one }) => ({
  accountCode: one(accountCode, {
    fields: [leaveTypes.accountCodeId],
    references: [accountCode.id],
  }),
  policy: one(leavePolicies, {
    fields: [leaveTypes.id],
    references: [leavePolicies.leaveTypeId],
  }),
  ledgerEntries: many(leaveBalanceLedger),
  encashments: many(leaveEncashments),
}));

export const leavePoliciesRelations = relations(leavePolicies, ({ one }) => ({
  leaveType: one(leaveTypes, {
    fields: [leavePolicies.leaveTypeId],
    references: [leaveTypes.id],
  }),
  encashmentAccountCode: one(accountCode, {
    fields: [leavePolicies.encashmentAccountCodeId],
    references: [accountCode.id],
  }),
}));

export const leaveBalanceLedgerRelations = relations(
  leaveBalanceLedger,
  ({ one }) => ({
    employee: one(employees, {
      fields: [leaveBalanceLedger.employeeId],
      references: [employees.id],
    }),
    leaveType: one(leaveTypes, {
      fields: [leaveBalanceLedger.leaveTypeId],
      references: [leaveTypes.id],
    }),
  })
);

export const leaveEncashmentsRelations = relations(
  leaveEncashments,
  ({ one }) => ({
    employee: one(employees, {
      fields: [leaveEncashments.employeeId],
      references: [employees.id],
    }),
    leaveType: one(leaveTypes, {
      fields: [leaveEncashments.leaveTypeId],
      references: [leaveTypes.id],
    }),
    payrollPeriod: one(payrollPeriods, {
      fields: [leaveEncashments.payrollPeriodId],
      references: [payrollPeriods.id],
    }),
    accountCode: one(accountCode, {
      fields: [leaveEncashments.accountCodeId],
      references: [accountCode.id],
    }),
    manualPayrollEntry: one(manualPayrollEntries, {
      fields: [leaveEncashments.manualPayrollEntryId],
      references: [manualPayrollEntries.id],
    }),
  })
);

export const payrollPeriodsRelations = relations(payrollPeriods, ({ many }) => ({
  runs: many(payrollRuns),
  attendanceImportBatches: many(attendanceImportBatches),
  attendancePeriodOverrides: many(employeeAttendancePeriodOverrides),
  attendanceDayStatusOverrides: many(employeeAttendanceDayStatusOverrides),
  attendanceDayTypeOverrides: many(employeeAttendanceDayTypeOverrides),
  payrollExceptionRows: many(employeePayrollExceptionRows),
  loanInstallments: many(loanInstallments),
  salaryChanges: many(employeeSalaryChanges),
  leaveEncashments: many(leaveEncashments),
}));

export const payrollRunsRelations = relations(payrollRuns, ({ one, many }) => ({
  payrollPeriod: one(payrollPeriods, {
    fields: [payrollRuns.payrollPeriodId],
    references: [payrollPeriods.id],
  }),
  employees: many(payrollRunEmployees),
  events: many(payrollRunEvents),
}));

export const payrollRunEmployeesRelations = relations(
  payrollRunEmployees,
  ({ one, many }) => ({
    payrollRun: one(payrollRuns, {
      fields: [payrollRunEmployees.payrollRunId],
      references: [payrollRuns.id],
    }),
    employee: one(employees, {
      fields: [payrollRunEmployees.employeeId],
      references: [employees.id],
    }),
    salaryChange: one(employeeSalaryChanges, {
      fields: [payrollRunEmployees.salaryAdjustmentId],
      references: [employeeSalaryChanges.id],
    }),
    lines: many(payrollRunLines),
    loanPayments: many(loanPayments),
  })
);

export const payrollRunLinesRelations = relations(payrollRunLines, ({ one }) => ({
  payrollRunEmployee: one(payrollRunEmployees, {
    fields: [payrollRunLines.payrollRunEmployeeId],
    references: [payrollRunEmployees.id],
  }),
}));

export const manualPayrollEntriesRelations = relations(
  manualPayrollEntries,
  ({ one, many }) => ({
    payrollPeriod: one(payrollPeriods, {
      fields: [manualPayrollEntries.payrollPeriodId],
      references: [payrollPeriods.id],
    }),
    employee: one(employees, {
      fields: [manualPayrollEntries.employeeId],
      references: [employees.id],
    }),
    lines: many(manualPayrollEntryLines),
  })
);

export const manualPayrollEntryLinesRelations = relations(
  manualPayrollEntryLines,
  ({ one }) => ({
    manualPayrollEntry: one(manualPayrollEntries, {
      fields: [manualPayrollEntryLines.manualPayrollEntryId],
      references: [manualPayrollEntries.id],
    }),
    accountCode: one(accountCode, {
      fields: [manualPayrollEntryLines.accountCodeId],
      references: [accountCode.id],
    }),
  })
);

export const loanInstallmentsRelations = relations(loanInstallments, ({ one }) => ({
  loan: one(employeesLoans, {
    fields: [loanInstallments.loanId],
    references: [employeesLoans.id],
  }),
  payrollPeriod: one(payrollPeriods, {
    fields: [loanInstallments.payrollPeriodId],
    references: [payrollPeriods.id],
  }),
}));

export const loanPaymentsRelations = relations(loanPayments, ({ one }) => ({
  loan: one(employeesLoans, {
    fields: [loanPayments.loanId],
    references: [employeesLoans.id],
  }),
  installment: one(loanInstallments, {
    fields: [loanPayments.installmentId],
    references: [loanInstallments.id],
  }),
  payrollRunEmployee: one(payrollRunEmployees, {
    fields: [loanPayments.payrollRunEmployeeId],
    references: [payrollRunEmployees.id],
  }),
}));

export const payrollRunEventsRelations = relations(payrollRunEvents, ({ one }) => ({
  payrollRun: one(payrollRuns, {
    fields: [payrollRunEvents.payrollRunId],
    references: [payrollRuns.id],
  }),
}));

export const statutoryRuleVersionsRelations = relations(
  statutoryRuleVersions,
  ({ many }) => ({
    sssBrackets: many(sssContributionBrackets),
    philhealthRates: many(philhealthContributionRates),
    pagibigRates: many(pagibigContributionRates),
    birTaxBrackets: many(birWithholdingTaxBrackets),
  })
);

export const sssContributionBracketsRelations = relations(
  sssContributionBrackets,
  ({ one }) => ({
    version: one(statutoryRuleVersions, {
      fields: [sssContributionBrackets.versionId],
      references: [statutoryRuleVersions.id],
    }),
  })
);

export const philhealthContributionRatesRelations = relations(
  philhealthContributionRates,
  ({ one }) => ({
    version: one(statutoryRuleVersions, {
      fields: [philhealthContributionRates.versionId],
      references: [statutoryRuleVersions.id],
    }),
  })
);

export const pagibigContributionRatesRelations = relations(
  pagibigContributionRates,
  ({ one }) => ({
    version: one(statutoryRuleVersions, {
      fields: [pagibigContributionRates.versionId],
      references: [statutoryRuleVersions.id],
    }),
  })
);

export const birWithholdingTaxBracketsRelations = relations(
  birWithholdingTaxBrackets,
  ({ one }) => ({
    version: one(statutoryRuleVersions, {
      fields: [birWithholdingTaxBrackets.versionId],
      references: [statutoryRuleVersions.id],
    }),
  })
);
