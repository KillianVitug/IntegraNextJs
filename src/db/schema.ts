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

// Lookup Tables
const createLookupTable = (name: string) =>
  pgTable(name, {
    id: integer("id").primaryKey(),
    name: varchar("name", { length: 50 }).unique().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  });

export const department = createLookupTable("department");
export const position = createLookupTable("position");

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

//ENUMs - Fixed Values
export const categoryEnum = pgEnum("category", [
  "Daily",
  "Weekly",
  "Monthly",
  "Other",
]);
export const employmentStatusEnum = pgEnum("employment_status", [
  "Active",
  "Resigned",
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
  "Manager",
  "Executive",
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
export const statusEnum = pgEnum("recurring_status", ["Active", "Paid"]);
export const frequencyEnum = pgEnum("recurring_frequency", [
  "Once",
  "Daily",
  "Weekly",
  "Monthly",
  "Yearly",
  "Other",
]);
export const leaveTypeEnum = pgEnum("leave_type", ["SL", "VL"]);

// Employees Table
export const employees = pgTable(
  "employees",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeNo: varchar("employee_no", { length: 50 }).unique().notNull(),
    firstName: varchar("first_name", { length: 50 }).notNull(),
    lastName: varchar("last_name", { length: 50 }).notNull(),
    middleName: varchar("middle_name", { length: 50 }),
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
    customPayrollCode: varchar("custom_payroll_code", { length: 50 }),
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

  leaveBalances: one(employeesLeaveBalances),
  leaveRecords: many(employeesLeaveRecords),
}));

export const employeesRecurringEntriesRelations = relations(
  employeesRecurringEntries,
  ({ one }) => ({
    employee: one(employees, {
      fields: [employeesRecurringEntries.employeeId],
      references: [employees.id],
    }),
  })
);

// Sick And Leave Tables
export const employeesLeaveBalances = pgTable(
  "employees_leave_balances",
  {
    id: serial("id").primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    year: integer("year").notNull(), // e.g. 2025
    vacationLeave: decimal("vacation_leave", { precision: 5, scale: 2 })
      .default("0.00")
      .notNull(),
    sickLeave: decimal("sick_leave", { precision: 5, scale: 2 })
      .default("0.00")
      .notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("idx_leave_balance_employee_id").on(table.employeeId),
    index("idx_leave_balance_year").on(table.year),
  ]
);

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
    approved: boolean("approved").default(false),
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

export const employeesLeaveBalancesRelations = relations(
  employeesLeaveBalances,
  ({ one }) => ({
    employee: one(employees, {
      fields: [employeesLeaveBalances.employeeId],
      references: [employees.id],
    }),
  })
);

export const employeesLeaveRecordsRelations = relations(
  employeesLeaveRecords,
  ({ one }) => ({
    employee: one(employees, {
      fields: [employeesLeaveRecords.employeeId],
      references: [employees.id],
    }),
  })
);
