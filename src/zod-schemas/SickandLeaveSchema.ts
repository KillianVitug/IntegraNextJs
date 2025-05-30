import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeesLeaveBalances } from "@/db/schema";
import { z } from "zod";

export const insertEmployeeTimekeepingSchema = createInsertSchema(employeesLeaveBalances, {
    // id: z.number().optional(),
    // employeeId: z.string().uuid().optional(),

});
export const selectEmployeeTimekeepingSchema = createSelectSchema(employeesLeaveBalances);

export type InsertEmployeeTimekeepingSchemaType = z.infer<typeof insertEmployeeTimekeepingSchema>;
export type SelectEmployeeTimekeepingSchemaType = z.infer<typeof selectEmployeeTimekeepingSchema>;
