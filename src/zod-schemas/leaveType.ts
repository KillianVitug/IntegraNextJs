import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { leaveTypes } from "@/db/schema";
import { z } from "zod";

const requiredAccountCodeId = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.coerce.number().int().min(1, "Payroll Account Code is required")
);

const optionalAccountCodeId = z.preprocess(
  (value) => (value === "" || value == null || value === 0 ? null : value),
  z.coerce.number().int().positive().nullable()
);

export const insertLeaveTypeSchema = createInsertSchema(leaveTypes, {
  id: z.coerce.number().optional(),
  accountCodeId: requiredAccountCodeId,
  annualEntitlement: z.coerce.number().default(0),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
}).extend({
  carryoverLimit: z.coerce.number().min(0).default(0),
  expiryMonth: z.coerce.number().int().min(1).max(12).default(12),
  expiryDay: z.coerce.number().int().min(1).max(31).default(31),
  encashmentEnabled: z.coerce.boolean().default(false),
  encashmentTaxable: z.coerce.boolean().default(true),
  encashmentMonth13thEligible: z.coerce.boolean().default(false),
  encashmentAccountCodeId: optionalAccountCodeId.default(null),
  halfDayAllowed: z.coerce.boolean().default(true),
  excludeRestDaysAndHolidays: z.coerce.boolean().default(true),
});

const baseSelectLeaveTypeSchema = createSelectSchema(leaveTypes, {
  accountCodeId: z.coerce.number().nullable(),
  annualEntitlement: z.coerce.number(),
});

export const selectLeaveTypeSchema = baseSelectLeaveTypeSchema.extend({
  payrollAccountCode: z.string().nullable().optional(),
  payrollAccountDisplay: z.string().nullable().optional(),
  carryoverLimit: z.coerce.number().optional(),
  expiryMonth: z.coerce.number().optional(),
  expiryDay: z.coerce.number().optional(),
  encashmentEnabled: z.boolean().optional(),
  encashmentTaxable: z.boolean().optional(),
  encashmentMonth13thEligible: z.boolean().optional(),
  encashmentAccountCodeId: z.coerce.number().nullable().optional(),
  halfDayAllowed: z.boolean().optional(),
  excludeRestDaysAndHolidays: z.boolean().optional(),
});

export const deleteLeaveTypeSchema = z.object({
  id: z.coerce.number().positive(),
});

export type InsertLeaveTypeSchemaType = z.infer<typeof insertLeaveTypeSchema>;
export type SelectLeaveTypeSchemaType = z.infer<typeof selectLeaveTypeSchema>;
