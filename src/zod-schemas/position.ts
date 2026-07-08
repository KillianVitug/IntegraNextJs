import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { position } from "@/db/schema";
import { z } from "zod";

// Insert Schema (used when adding a new Position)
export const insertPositionSchema = createInsertSchema(position, {
    id: z.number().optional().or(z.literal(0)),
    name: (schema) => schema.min(1, "Position Name is required"),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
})

// Select Schema (used when retrieving a Position from the database)
export const selectPositionSchema = createSelectSchema(position);

// ✅ Delete Schema (used when deleting a Position)
export const deletePositionSchema = z.object({
    id: z.coerce
      .number()
      .positive("Position ID must be a positive number"),
  });

// Types
export type InsertPositionSchemaType = z.infer<typeof insertPositionSchema>;
export type SelectPositionSchemaType = z.infer<typeof selectPositionSchema>;
export type DeletePositionSchemaType = z.infer<typeof deletePositionSchema>;
