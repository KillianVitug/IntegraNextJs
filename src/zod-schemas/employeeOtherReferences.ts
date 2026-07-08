import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  bankCodeTypeEnum,
  civilStatusEnum,
  employeesOtherReferences,
  genderEnum,
} from "@/db/schema";
import { z } from "zod";

export const insertEmployeeOtherReferencesSchema = createInsertSchema(
  employeesOtherReferences,
  {
    id: z.number().optional(),
    employeeId: z.string().uuid().optional(),
    age: z.coerce.number().nullable().optional(),
    bankCode: z.enum(bankCodeTypeEnum.enumValues).nullable().optional(),
    positionId: z.string().nullable().optional(),
    civilStatus: z.enum(civilStatusEnum.enumValues).nullable().optional(),
    gender: z.enum(genderEnum.enumValues).nullable().optional(),
  },
);

export const selectEmployeeOtherReferencesSchema = createSelectSchema(
  employeesOtherReferences,
  {
    bankCode: z.enum(bankCodeTypeEnum.enumValues).nullable(),
    civilStatus: z.enum(civilStatusEnum.enumValues).nullable(),
    gender: z.enum(genderEnum.enumValues).nullable(),
  },
);

export type InsertEmployeeOtherReferencesSchemaType = z.infer<
  typeof insertEmployeeOtherReferencesSchema
>;
export type SelectEmployeeOtherReferencesSchemaType = z.infer<
  typeof selectEmployeeOtherReferencesSchema
>;
