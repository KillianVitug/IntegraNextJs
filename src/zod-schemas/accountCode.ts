import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { accountCode } from "@/db/schema";
import { z } from "zod";

// Insert Schema (used when adding a new accountCode)
export const insertAccountCodeSchema = createInsertSchema(accountCode, {
    id: z.coerce.number().optional(),
    dailyRate: z.coerce.number().nullable().optional(),
    monthlyRate: z.coerce.number().nullable().optional(),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
})

// Select Schema (used when retrieving a department from the database)
export const selectAccountCodeSchema = createSelectSchema(accountCode, {
    // 👇 convert DB decimals (string) into numbers for the client
    id: z.coerce.number().optional(),
    dailyRate: z.coerce.number().nullable(),
    monthlyRate: z.coerce.number().nullable(),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
  });

// ✅ Delete Schema (used when deleting a department)
export const deleteAccountCodeSchema = z.object({
    id: z
      .number({
        required_error: "Account Code ID is required for deletion",
        invalid_type_error: "Account Code ID must be a number",
      })
      .positive("Account Code ID must be a positive number"),
  });

export const updateAccountCodeSchema = insertAccountCodeSchema.extend({
    id: z.coerce.number({
      required_error: "Account Code ID is required for update",
    }),
    
    
}).passthrough();
  
// Types
export type InsertAccountCodeSchemaType = z.infer<typeof insertAccountCodeSchema>;
export type UpdateAccountCodeSchemaType = z.infer<typeof updateAccountCodeSchema>;
export type SelectAccountCodeSchemaType = z.infer<typeof selectAccountCodeSchema>;
export type DeleteAccountCodeSchemaType = z.infer<typeof deleteAccountCodeSchema>;
