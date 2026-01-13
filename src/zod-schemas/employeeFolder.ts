import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeeFolders } from "@/db/schema";
import { z } from "zod";

const fileMetaSchema = z.object({
  id: z.string(),
  fileName: z.string().min(1),
  description: z.string().nullable(),
  remarks: z.string().nullable(),
  file: z.any().optional(), // only for new uploads
  previewUrl: z.string().optional(),
  filePath: z.any().optional(),
});

const baseFolderInsert = createInsertSchema(employeeFolders, {
  id: z.string().uuid(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

// Insert Schema (used when adding a new employee)
export const insertEmployeeFolderSchema = baseFolderInsert.extend({
  files: z.array(fileMetaSchema).optional().default([]),
});


// Select Schema (used when retrieving an employee from the database)
export const selectEmployeeFolderSchema = createSelectSchema(employeeFolders);


// Types
export type InsertEmployeeFolderSchemaType = z.infer<typeof insertEmployeeFolderSchema>;
export type SelectEmployeeFolderSchemaType = z.infer<typeof selectEmployeeFolderSchema>;
