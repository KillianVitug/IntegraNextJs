import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeesTimekeeping } from "@/db/schema";
import { z } from "zod";

const numericString = z.preprocess(
    (val) => {
      if (val === null || val === undefined || val === "") return "";
      if (typeof val === "number") return val.toString();
      if (typeof val === "string") return val.trim();
      return val;
    },
    z
      .string()
      .regex(/^\d*\.?\d*$/, "Must be a number")
      .or(z.literal(""))
      .nullable()
      .optional()
  );

export const insertEmployeeTimekeepingSchema = createInsertSchema(employeesTimekeeping, {
    id: z.number().optional(),
    employeeId: z.string().uuid().optional(),
    hoursWorked: numericString,
    minutesWorked: numericString
});
export const selectEmployeeTimekeepingSchema = createSelectSchema(employeesTimekeeping);

export type InsertEmployeeTimekeepingSchemaType = z.infer<typeof insertEmployeeTimekeepingSchema>;
export type SelectEmployeeTimekeepingSchemaType = z.infer<typeof selectEmployeeTimekeepingSchema>;
