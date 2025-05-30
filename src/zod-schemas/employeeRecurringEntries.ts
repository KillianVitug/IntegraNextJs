import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeesRecurringEntries } from "@/db/schema";
import { z } from "zod";

const numericString = z.preprocess(
  (val) => {
    if (val === null || val === undefined || val === "") return "0"; // <- use a fallback value
    if (typeof val === "number") return val.toString();
    if (typeof val === "string") return val.trim();
    return val;
  },
  z.string().regex(/^\d*\.?\d*$/, "Must be a number")
);

export const insertEmployeeRecurringEntriesSchema = createInsertSchema(employeesRecurringEntries, {
    id: z.union([z.literal("(New)"), z.number()]),
    employeeId: z.string().uuid(),
    amount: numericString,
});
export const selectEmployeeRecurringEntriesSchema = createSelectSchema(employeesRecurringEntries);

export type InsertEmployeeRecurringEntriesSchemaType = z.infer<typeof insertEmployeeRecurringEntriesSchema>;
export type SelectEmployeeRecurringEntriesSchemaType = z.infer<typeof selectEmployeeRecurringEntriesSchema>;

