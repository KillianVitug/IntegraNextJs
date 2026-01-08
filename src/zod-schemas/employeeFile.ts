import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeeFiles, employees } from "@/db/schema";
import { z } from "zod";


// Insert Schema (used when adding a new employee)
export const insertEmployeeFileSchema = createInsertSchema(employeeFiles, {
    id: z.string().uuid(),
    groupId: z.string().uuid().optional(),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
}).extend({

});

// Select Schema (used when retrieving an employee from the database)
export const selectEmployeeFileSchema = createSelectSchema(employeeFiles);

export const selectEmployeeFileWithRelationsSchema = selectEmployeeFileSchema.extend({
});

// Types
export type InsertEmployeeFileSchemaType = z.infer<typeof insertEmployeeFileSchema>;
export type SelectEmployeeFileSchemaType = z.infer<typeof selectEmployeeFileWithRelationsSchema>;
