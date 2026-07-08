import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeeFileTypeEnum, employeeFolders } from "@/db/schema";
import { z } from "zod";

const fileMetaSchema = z.object({
  id: z.string(),
  fileName: z.string().min(1),
  description: z.string().nullable(),
  remarks: z.string().nullable(),
  file: z.any().optional(),
  previewUrl: z.string().optional(),
  filePath: z.any().optional(),
});

const baseFolderInsert = createInsertSchema(employeeFolders, {
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  folderType: z.enum(employeeFileTypeEnum.enumValues),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

export const insertEmployeeFolderSchema = baseFolderInsert.extend({
  files: z.array(fileMetaSchema).optional().default([]),
});

export const selectEmployeeFolderSchema = createSelectSchema(employeeFolders, {
  folderType: z.enum(employeeFileTypeEnum.enumValues),
});

export type InsertEmployeeFolderSchemaType = z.infer<typeof insertEmployeeFolderSchema>;
export type SelectEmployeeFolderSchemaType = z.infer<typeof selectEmployeeFolderSchema>;
