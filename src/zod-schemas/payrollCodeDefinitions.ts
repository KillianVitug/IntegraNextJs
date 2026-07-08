import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { customPayrollDefinitions } from "@/db/schema";
import { z } from "zod";

const numericString = z.preprocess((val) => {
  if (val === "") return null;
  if (val == null) return null;
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return val.replace(/,/g, "").trim();
  return val;
}, z.string().regex(/^\d*\.?\d*$/, "Must be a number").nullable());


// Form Purposes
export const insertCustomPayrollDefinitionSchema =
  createInsertSchema(customPayrollDefinitions, {
    code: z.string().min(1),
    description: z.string().nullable(),
    rateDivisor: numericString.nullable(),
    hourlyRateDivisor: numericString.nullable(),
  });

export const selectCustomPayrollDefinitionSchema =
  createSelectSchema(customPayrollDefinitions);

export type InsertCustomPayrollDefinition =
  z.infer<typeof insertCustomPayrollDefinitionSchema>;

// Server Purposes
export const customPayrollDefinitionInputSchema = z.object({
    code: z.string().min(1),
    description: z.string().nullable(),
    rateDivisor: numericString.nullable(),
    hourlyRateDivisor: numericString.nullable(),
  });
  
export type CustomPayrollDefinitionInput =
    z.infer<typeof customPayrollDefinitionInputSchema>;
  