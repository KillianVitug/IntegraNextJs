import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employees } from "@/db/schema";
import { z } from "zod";
import { insertEmployeeGeneralInfoSchema, selectEmployeeGeneralInfoSchema } from "./employeeGeneralInfo";
import { insertEmployeeSalarySchema, selectEmployeeSalarySchema } from "./employeeSalary";
import { insertEmployeeOtherReferencesSchema, selectEmployeeOtherReferencesSchema } from "./employeeOtherReferences";
import { insertEmployeeRecurringEntriesSchema, selectEmployeeRecurringEntriesSchema } from "./employeeRecurringEntries";
import { insertEmployeeTimekeepingSchema, selectEmployeeTimekeepingSchema } from "./employeeTimekeeping";
import {
    DEFAULT_EMPLOYEE_TYPE,
    employeeTypeValues,
} from "@/utils/employeeCode";

// Insert Schema (used when adding a new employee)
export const insertEmployeeSchema = createInsertSchema(employees, {
    id: z.string().uuid().optional(),
    employeeType: z.enum(employeeTypeValues).default(DEFAULT_EMPLOYEE_TYPE),
    employeeNo: (schema) => schema.optional(),
    firstName: (schema) => schema.min(1, "First Name is required"),
    lastName: (schema) => schema.min(1, "Last Name is required"),
}).extend({
    generalInfo: insertEmployeeGeneralInfoSchema.optional(),
    salary: insertEmployeeSalarySchema.optional(),
    otherReferences: insertEmployeeOtherReferencesSchema.optional(),
    timekeeping: insertEmployeeTimekeepingSchema.optional(),
    recurringEntries: insertEmployeeRecurringEntriesSchema.array().optional(),
});

// Select Schema (used when retrieving an employee from the database)
export const selectEmployeeSchema = createSelectSchema(employees, {
    employeeType: z.enum(employeeTypeValues),
});

export const selectEmployeeWithRelationsSchema = selectEmployeeSchema.extend({
    generalInfo: selectEmployeeGeneralInfoSchema.optional(),
    salary: selectEmployeeSalarySchema.optional(),
    otherReferences: selectEmployeeOtherReferencesSchema.optional(),
    timekeeping: selectEmployeeTimekeepingSchema.optional(),
    recurringEntries: selectEmployeeRecurringEntriesSchema.array().optional(),
});

// Types
export type InsertEmployeeSchemaType = z.infer<typeof insertEmployeeSchema>;
export type SelectEmployeeWithRelationsSchemaType = z.infer<typeof selectEmployeeWithRelationsSchema>;
