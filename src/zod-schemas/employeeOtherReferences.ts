import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeesOtherReferences } from "@/db/schema";
import { z } from "zod";

export const insertEmployeeOtherReferencesSchema = createInsertSchema(employeesOtherReferences, {
    id: z.number().optional(),
    employeeId: z.string().uuid().optional(),
    age: z.coerce.number().nullable().optional(),
    positionId: z.string().nullable().optional(),
});
export const selectEmployeeOtherReferencesSchema = createSelectSchema(employeesOtherReferences);

export type InsertEmployeeOtherReferencesSchemaType = z.infer<typeof insertEmployeeOtherReferencesSchema>;
export type SelectEmployeeOtherReferencesSchemaType = z.infer<typeof selectEmployeeOtherReferencesSchema>;
