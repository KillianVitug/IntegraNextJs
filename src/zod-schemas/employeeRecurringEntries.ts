import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  employeesRecurringEntries,
  frequencyEnum,
  statusEnum,
} from "@/db/schema";
import { z } from "zod";

const numericString = z.preprocess(
  (val) => {
    if (val === null || val === undefined || val === "") return "0";
    if (typeof val === "number") return val.toString();
    if (typeof val === "string") return val.trim();
    return val;
  },
  z.string().regex(/^(?:\d+\.?\d*|\.\d+)$/, "Must be a number"),
);

export const insertEmployeeRecurringEntriesSchema = createInsertSchema(
  employeesRecurringEntries,
  {
    id: z.union([z.literal("(New)"), z.number()]),
    employeeId: z.string().uuid(),
    amount: numericString,
    frequency: z.enum(frequencyEnum.enumValues).nullable().optional(),
    status: z.enum(statusEnum.enumValues).nullable().optional(),
  },
);

export const selectEmployeeRecurringEntriesSchema = createSelectSchema(
  employeesRecurringEntries,
  {
    frequency: z.enum(frequencyEnum.enumValues).nullable(),
    status: z.enum(statusEnum.enumValues).nullable(),
  },
);

export type InsertEmployeeRecurringEntriesSchemaType = z.infer<
  typeof insertEmployeeRecurringEntriesSchema
>;
export type SelectEmployeeRecurringEntriesSchemaType = z.infer<
  typeof selectEmployeeRecurringEntriesSchema
>;

export const employeeRecurringEntryFormSchema =
  selectEmployeeRecurringEntriesSchema.pick({
    id: true,
    employeeId: true,
    accountCode: true,
    description: true,
    amount: true,
    frequency: true,
    status: true,
    startDate: true,
    endDate: true,
  });

export type EmployeeRecurringEntryFormType = z.infer<
  typeof employeeRecurringEntryFormSchema
>;

export const saveEmployeeRecurringEntriesSchema = z.object({
  employeeId: z.string().uuid(),
  entries: z.array(
    z.object({
      id: z.number().int().positive().optional().nullable(),
      accountCode: z.string().trim().max(50),
      amount: numericString,
      description: z.string().trim().max(1000).optional().nullable(),
    }),
  ),
});

export type SaveEmployeeRecurringEntriesSchemaType = z.infer<
  typeof saveEmployeeRecurringEntriesSchema
>;

export type EmployeeRecurringAccountCodeOption = {
  id: number;
  code: string;
  accountType: "Other Income" | "Other Deduction";
  description: string | null;
  dailyRate: string | null;
  monthlyRate: string | null;
};
