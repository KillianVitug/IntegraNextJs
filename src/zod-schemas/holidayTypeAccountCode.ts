import { createSelectSchema } from "drizzle-zod";
import { holidayTypeAccountCodes, holidayTypeEnum } from "@/db/schema";
import { z } from "zod";

const optionalAccountCodeId = z.preprocess(
  (value) => (value === "" || value == null || value === 0 ? null : value),
  z.coerce.number().int().positive().nullable()
);

export const saveHolidayTypeAccountCodeSchema = z.object({
  holidayType: z.enum(holidayTypeEnum.enumValues),
  accountCodeId: optionalAccountCodeId,
  overtimeAccountCodeId: optionalAccountCodeId,
  restDayAccountCodeId: optionalAccountCodeId,
  restDayOvertimeAccountCodeId: optionalAccountCodeId,
});

export const selectHolidayTypeAccountCodeSchema = createSelectSchema(
  holidayTypeAccountCodes,
  {
    holidayType: z.enum(holidayTypeEnum.enumValues),
    accountCodeId: z.coerce.number().nullable(),
    overtimeAccountCodeId: z.coerce.number().nullable(),
    restDayAccountCodeId: z.coerce.number().nullable(),
    restDayOvertimeAccountCodeId: z.coerce.number().nullable(),
  }
).extend({
  accountCode: z.string().nullable().optional(),
  accountDescription: z.string().nullable().optional(),
  accountDisplay: z.string().nullable().optional(),
  overtimeAccountCode: z.string().nullable().optional(),
  overtimeAccountDescription: z.string().nullable().optional(),
  overtimeAccountDisplay: z.string().nullable().optional(),
  restDayAccountCode: z.string().nullable().optional(),
  restDayAccountDescription: z.string().nullable().optional(),
  restDayAccountDisplay: z.string().nullable().optional(),
  restDayOvertimeAccountCode: z.string().nullable().optional(),
  restDayOvertimeAccountDescription: z.string().nullable().optional(),
  restDayOvertimeAccountDisplay: z.string().nullable().optional(),
});

export type SaveHolidayTypeAccountCodeSchemaType = z.infer<
  typeof saveHolidayTypeAccountCodeSchema
>;
export type SelectHolidayTypeAccountCodeSchemaType = z.infer<
  typeof selectHolidayTypeAccountCodeSchema
>;
