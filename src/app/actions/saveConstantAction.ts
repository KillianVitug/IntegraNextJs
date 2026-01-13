"use server";

import { eq } from "drizzle-orm";
import { flattenValidationErrors } from "next-safe-action";
import { db } from "@/db";
import { department, accountCode, position } from "@/db/schema";
import { actionClient } from "@/lib/safe-action";
import {
  deleteDepartmentSchema,
  insertDepartmentSchema,
  type InsertDepartmentSchemaType,
} from "@/zod-schemas/department";
import {
  deleteAccountCodeSchema,
  insertAccountCodeSchema,
  updateAccountCodeSchema,
  type InsertAccountCodeSchemaType,
  type UpdateAccountCodeSchemaType,
} from "@/zod-schemas/accountCode";
import { insertPositionSchema, deletePositionSchema, type InsertPositionSchemaType} from "@/zod-schemas/position";

// 🔹 Create Department
export const saveDepartmentAction = actionClient
  .metadata({ actionName: "saveDepartmentAction" })
  .schema(insertDepartmentSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({ parsedInput }: { parsedInput: InsertDepartmentSchemaType }) => {
      try {
        const result = await db
          .insert(department)
          .values({
            name: parsedInput.name,
            code: parsedInput.code,
          } satisfies Partial<typeof department.$inferInsert>)
          .returning({ insertedId: department.id });

        return {
          message: `✅ Department ID #${result[0].insertedId} created successfully`,
        };
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes("duplicate key value")) {
          return { error: "❌ Department name or code already exists." };
        }
        console.error(error);
        return { error: "❌ Unexpected error while saving department." };
      }
    }
  );
// 🔹 Update Department
export const updateDepartmentAction = actionClient
  .metadata({ actionName: "updateDepartmentAction" })
  .schema(insertDepartmentSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({ parsedInput }: { parsedInput: InsertDepartmentSchemaType }) => {
      try {
        if (!parsedInput.id) {
          return { error: "❌ Department ID is required for update." };
        }

        const result = await db
          .update(department)
          .set({
            name: parsedInput.name,
            code: parsedInput.code,
          })
          .where(eq(department.id, parsedInput.id))
          .returning({ updatedId: department.id });

        return {
          message: `✅ Department ID #${result[0].updatedId} updated successfully`,
        };
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes("duplicate key value")) {
          return { error: "❌ Department name or code already exists." };
        }
        console.error(error);
        return { error: "❌ Unexpected error while updating department." };
      }
    }
  );
// 🔹 Delete Department
export const deleteDepartmentAction = actionClient
  .metadata({ actionName: "deleteDepartmentAction" })
  .schema(deleteDepartmentSchema)
  .action(async ({ parsedInput }) => {
    await db.delete(department).where(eq(department.id, parsedInput.id));
    return {
      message: `🗑️ Department ID #${parsedInput.id} deleted successfully`,
    };
  });


// 🔹 Create AccountCode
export const saveAccountCodeAction = actionClient
  .metadata({ actionName: "saveAccountCodeAction" })
  .schema(insertAccountCodeSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({ parsedInput }: { parsedInput: InsertAccountCodeSchemaType }) => {
      try {
        // ✅ Convert numbers to strings for decimal fields
        const dailyRate =
          parsedInput.dailyRate !== null && parsedInput.dailyRate !== undefined
            ? parsedInput.dailyRate.toString()
            : null;

        const monthlyRate =
          parsedInput.monthlyRate !== null &&
          parsedInput.monthlyRate !== undefined
            ? parsedInput.monthlyRate.toString()
            : null;

        const result = await db
          .insert(accountCode)
          .values({
            accountCode: parsedInput.accountCode,
            accountType: parsedInput.accountType,
            description: parsedInput.description,
            dailyRate,
            monthlyRate,
            month13thPay: parsedInput.month13thPay,
            nonTaxable: parsedInput.nonTaxable,
            deminimis: parsedInput.deminimis,
            healthInsurance: parsedInput.healthInsurance,
          } satisfies Partial<typeof accountCode.$inferInsert>)
          .returning({ insertedId: accountCode.id });

        return {
          message: `✅ Account Code ID #${result[0].insertedId} created successfully`,
        };
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes("duplicate key value")) {
          return { error: "❌ Account Code ID already exists." };
        }
        console.error(error);
        return { error: "❌ Unexpected error while saving Account Code." };
      }      
    }
  );

// 🔹 Update Account Code
export const updateAccountCodeAction = actionClient
  .metadata({ actionName: "updateAccountCodeAction" })
  .schema(updateAccountCodeSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({ parsedInput }: { parsedInput: UpdateAccountCodeSchemaType }) => {
      try {
        const dailyRate =
          parsedInput.dailyRate != null
            ? parsedInput.dailyRate.toString()
            : null;
        const monthlyRate =
          parsedInput.monthlyRate != null
            ? parsedInput.monthlyRate.toString()
            : null;

        const result = await db
          .update(accountCode)
          .set({
            accountType: parsedInput.accountType,
            accountCode: parsedInput.accountCode,
            description: parsedInput.description,
            dailyRate,
            monthlyRate,
            month13thPay: parsedInput.month13thPay,
            nonTaxable: parsedInput.nonTaxable,
            deminimis: parsedInput.deminimis,
            healthInsurance: parsedInput.healthInsurance,
            updatedAt: new Date(),
          })
          .where(eq(accountCode.id, parsedInput.id))
          .returning({ updatedId: accountCode.id });

        return {
          message: `✅ Account Code ID #${result[0].updatedId} updated successfully`,
        };
      } catch (error: unknown) {
        console.error(error);
        return { error: "❌ Unexpected error while updating Account Code." };
      }      
    }
  );

// 🔹 Delete Account Code
export const deleteAccountCodeAction = actionClient
  .metadata({ actionName: "deleteAccountCodeAction" })
  .schema(deleteAccountCodeSchema)
  .action(async ({ parsedInput }) => {
    await db.delete(accountCode).where(eq(accountCode.id, parsedInput.id));
    return {
      message: `🗑️ Account Code ID #${parsedInput.id} deleted successfully`,
    };
  });


  // 🔹 Create Position
export const savePositionAction = actionClient
.metadata({ actionName: "savePositiontAction" })
.schema(insertPositionSchema, {
  handleValidationErrorsShape: async (ve) =>
    flattenValidationErrors(ve).fieldErrors,
})
.action(
  async ({ parsedInput }: { parsedInput: InsertPositionSchemaType }) => {
    try {
      const result = await db
        .insert(position)
        .values({
          name: parsedInput.name,
        } satisfies Partial<typeof position.$inferInsert>)
        .returning({ insertedId: position.id });

      return {
        message: `✅ Position ID #${result[0].insertedId} created successfully`,
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("duplicate key value")) {
        return { error: "❌ Position name or code already exists." };
      }
      console.error(error);
      return { error: "❌ Unexpected error while saving position." };
    }    
  }
);
// 🔹 Update Position
export const updatePositionAction = actionClient
.metadata({ actionName: "updatePositionAction" })
.schema(insertPositionSchema, {
  handleValidationErrorsShape: async (ve) =>
    flattenValidationErrors(ve).fieldErrors,
})
.action(
  async ({ parsedInput }: { parsedInput: InsertPositionSchemaType }) => {
    try {
      if (!parsedInput.id) {
        return { error: "❌ Position ID is required for update." };
      }

      const result = await db
        .update(position)
        .set({
          name: parsedInput.name,
        })
        .where(eq(position.id, parsedInput.id))
        .returning({ updatedId: position.id });

      return {
        message: `✅ Position ID #${result[0].updatedId} updated successfully`,
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("duplicate key value")) {
        return { error: "❌ Position name or code already exists." };
      }
      console.error(error);
      return { error: "❌ Unexpected error while updating position." };
    }    
  }
);

// 🔹 Delete Position
export const deletePositionAction = actionClient
.metadata({ actionName: "deletePositionAction" })
.schema(deletePositionSchema)
.action(async ({ parsedInput }) => {
  await db.delete(position).where(eq(position.id, parsedInput.id));
  return {
    message: `🗑️ Position ID #${parsedInput.id} deleted successfully`,
  };
});