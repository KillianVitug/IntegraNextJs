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
  index,
  serial,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
export const loanStatusEnum = pgEnum("loan_status_enum", [
  "Active",
  "Paid",
  "Inactive",
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

// export const bankCodeTypeEnum = pgEnum("")

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
  dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }),
  monthlyRate: decimal("monthly_rate", { precision: 10, scale: 2 }),
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

// Employees Table
export const employees = pgTable(
  "employees",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeNo: varchar("employee_no", { length: 50 }).unique().notNull(),
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
  (table) => [index("idx_employee_no").on(table.employeeNo)]
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
  (table) => [index("idx_general_employee_id").on(table.employeeId)]
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
    dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }),
    monthlyRate: decimal("monthly_rate", { precision: 10, scale: 2 }),
    monthlyAllowance: decimal("monthly_allowance", { precision: 10, scale: 2 }),
    dailyAllowance: decimal("daily_allowance", { precision: 10, scale: 2 }),
    cola: decimal("cola", { precision: 10, scale: 2 }),
    rateDivisor: decimal("rate_divisor", { precision: 10, scale: 2 }),
    billingRate: decimal("billing_rate", { precision: 10, scale: 2 }),
    customPayrollCode: varchar("custom_payroll_code", {
      length: 50,
    }).references(() => customPayrollDefinitions.code, {
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
    bankCode: varchar("bank_code", { length: 50 }),
    bankAccountNo: varchar("bank_account_no", { length: 50 }),
    positionId: integer("position_id").references(() => position.id, {
      onDelete: "set null",
    }),
    address: text("address"),
    email: varchar("email", { length: 50 }),
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
  (table) => [index("idx_references_employee_id").on(table.employeeId)]
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
  (table) => [index("idx_entries_employee_id").on(table.employeeId)]
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

  loans: many(employeesLoans),

  folders: many(employeeFolders),
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
    dateFiled: date("date_filed").notNull(),
    leaveType: leaveTypeEnum("leave_type").notNull(),
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
  ]
);

//LEAVE RELATIONS
export const employeesLeaveRecordsRelations = relations(
  employeesLeaveRecords,
  ({ one }) => ({
    employee: one(employees, {
      fields: [employeesLeaveRecords.employeeId],
      references: [employees.id],
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
    oldDailyRate: decimal("old_daily_rate", { precision: 10, scale: 2 }),
    oldMonthlyRate: decimal("old_monthly_rate", { precision: 10, scale: 2 }),
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
    newDailyRate: decimal("new_daily_rate", { precision: 10, scale: 2 }),
    newMonthlyRate: decimal("new_monthly_rate", { precision: 10, scale: 2 }),
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
  },
  (table) => [index("idx_salary_adjustment_employee_id").on(table.employeeId)]
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
      length: 50,
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
    employeeAssignments: many(employeeCustomPayroll),
    contributionGroups: many(employeeContributionGroups),
  })
);
export const employeesSalaryRelations = relations(
  employeesSalary,
  ({ one }) => ({
    customPayroll: one(customPayrollDefinitions, {
      fields: [employeesSalary.customPayrollCode],   // must be *_id
      references: [customPayrollDefinitions.id],   // must be id
    }),
  })
);
export const employeeContributionGroupsRelations = relations(
  employeeContributionGroups,
  ({ one }) => ({
    flags: one(employeeContributionFlags),
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
