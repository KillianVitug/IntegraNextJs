import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { department } from "@/db/schema";
import { z } from "zod";

// Insert Schema (used when adding a new department)
export const insertDepartmentSchema = createInsertSchema(department, {
    id: z.number().optional().or(z.literal(0)),
    name: (schema) => schema.min(1, "Department Name is required"),
    code: (schema) => schema.min(1, "Department Code is required"),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
})

// Select Schema (used when retrieving a department from the database)
export const selectDepartmentSchema = createSelectSchema(department);

// ✅ Delete Schema (used when deleting a department)
export const deleteDepartmentSchema = z.object({
    id: z
      .number({
        required_error: "Department ID is required for deletion",
        invalid_type_error: "Department ID must be a number",
      })
      .positive("Department ID must be a positive number"),
  });

// Types
export type InsertDepartmentSchemaType = z.infer<typeof insertDepartmentSchema>;
export type SelectDepartmentSchemaType = z.infer<typeof selectDepartmentSchema>;
export type DeleteDepartmentSchemaType = z.infer<typeof deleteDepartmentSchema>;
