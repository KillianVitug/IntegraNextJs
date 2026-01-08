import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { customPayrollDefinitions } from "@/db/schema";
import { z } from "zod";

// Form Purposes
export const insertCustomPayrollDefinitionSchema =
  createInsertSchema(customPayrollDefinitions, {
    code: z.string().min(1),
    description: z.string().nullable(),
    rateDivisor: z.coerce.number().nullable(),
    hourlyRateDivisor: z.coerce.number().nullable(),
    
  });

export const selectCustomPayrollDefinitionSchema =
  createSelectSchema(customPayrollDefinitions);

export type InsertCustomPayrollDefinition =
  z.infer<typeof insertCustomPayrollDefinitionSchema>;

// Server Purposes
export const customPayrollDefinitionInputSchema = z.object({
    code: z.string().min(1),
    description: z.string().nullable(),
    rateDivisor: z.coerce.number().nullable(),
    hourlyRateDivisor: z.coerce.number().nullable(),
  });
  
export type CustomPayrollDefinitionInput =
    z.infer<typeof customPayrollDefinitionInputSchema>;
  