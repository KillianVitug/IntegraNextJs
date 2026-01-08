import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeesGeneralInfo } from "@/db/schema";
import { z } from "zod";

export const insertEmployeeGeneralInfoSchema = createInsertSchema(employeesGeneralInfo, {
    id: z.number().optional(),
    employeeId: z.string().uuid().optional(),
    departmentId: z.string().nullable().optional(),
});
export const selectEmployeeGeneralInfoSchema = createSelectSchema(employeesGeneralInfo);

export type InsertEmployeeGeneralInfoSchemaType = z.infer<typeof insertEmployeeGeneralInfoSchema>;
export type SelectEmployeeGeneralInfoSchemaType = z.infer<typeof selectEmployeeGeneralInfoSchema>;
