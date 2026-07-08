import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { accountCode, accountTypeEnum } from "@/db/schema";
import { z } from "zod";

const decimalStringUpTo4 = z.preprocess((value) => {
  if (value == null || value === "") return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.replace(/,/g, "").trim();
  return value;
}, z.string()
  .regex(/^(?:\d+\.?\d*|\.\d+)$/, "Must be a number")
  .refine(
    (value) => (value.split(".")[1]?.length ?? 0) <= 4,
    "Must have at most 4 decimal places"
  )
  .transform((value) => (value.endsWith(".") ? value.slice(0, -1) : value))
  .nullable());

export const insertAccountCodeSchema = createInsertSchema(accountCode, {
  id: z.coerce.number().optional(),
  accountType: z.enum(accountTypeEnum.enumValues).nullable().optional(),
  dailyRate: decimalStringUpTo4.optional(),
  monthlyRate: decimalStringUpTo4.optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

export const selectAccountCodeSchema = createSelectSchema(accountCode, {
  id: z.coerce.number().optional(),
  accountType: z.enum(accountTypeEnum.enumValues).nullable(),
  dailyRate: decimalStringUpTo4,
  monthlyRate: decimalStringUpTo4,
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

export const deleteAccountCodeSchema = z.object({
  id: z.coerce
    .number()
    .positive("Account Code ID must be a positive number"),
});

export const updateAccountCodeSchema = insertAccountCodeSchema
  .extend({
    id: z.coerce
      .number()
      .positive("Account Code ID is required for update"),
  })
  .passthrough();

export type InsertAccountCodeSchemaType = z.infer<typeof insertAccountCodeSchema>;
export type UpdateAccountCodeSchemaType = z.infer<typeof updateAccountCodeSchema>;
export type SelectAccountCodeSchemaType = z.infer<typeof selectAccountCodeSchema>;
export type DeleteAccountCodeSchemaType = z.infer<typeof deleteAccountCodeSchema>;
