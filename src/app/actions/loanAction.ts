"use server";
import { db } from "@/db";
import { employeesLoans } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { EmployeeLoanList, employeeLoanListSchema, insertEmployeeLoanSchema, type InsertEmployeeLoanSchemaType } from "@/zod-schemas/employeeLoan";
import { actionClient } from "@/lib/safe-action";
import { flattenValidationErrors } from "next-safe-action";


export async function getEmployeeLoan(loanId: string): Promise<EmployeeLoanList[]> {
  const result = await db
    .select({
      id: employeesLoans.id,
      employeeId: employeesLoans.employeeId,
      accountCodeId: employeesLoans.accountCodeId,
      loanReferenceNumber: employeesLoans.loanReferenceNumber,
      amountGranted: employeesLoans.amountGranted,
      payrollDateDeduction: employeesLoans.payrollDateDeduction,
      loanDate: employeesLoans.loanDate,
      paymentTerms: employeesLoans.paymentTerms,
      payableLoan: employeesLoans.payableLoan,
      loanTotalCredit: employeesLoans.loanTotalCredit,
      amortization: employeesLoans.amortization,
      loanBalance: employeesLoans.loanBalance,
      loanPaymentDate: employeesLoans.loanPaymentDate,
      status: employeesLoans.status,
    })
    .from(employeesLoans)
    .where(eq(employeesLoans.id, loanId))
    .orderBy(asc(employeesLoans.loanDate));

  return employeeLoanListSchema.array().parse(result);
}

// 🔹 Create Employee Loan
export const saveEmployeeLoanAction = actionClient
.metadata({ actionName: "saveEmployeeLoanAction" })
.schema(insertEmployeeLoanSchema, {
  handleValidationErrorsShape: async (ve) =>
    flattenValidationErrors(ve).fieldErrors,
})
.action(
  async ({ parsedInput }: { parsedInput: InsertEmployeeLoanSchemaType }) => {
    try {
      const result = await db
        .insert(employeesLoans)
        .values({
          employeeId: parsedInput.employeeId,
          accountCodeId: parsedInput.accountCodeId,
          loanReferenceNumber: parsedInput.loanReferenceNumber,
          amountGranted: parsedInput.amountGranted,
          payrollDateDeduction: parsedInput.payrollDateDeduction,
          loanDate: parsedInput.loanDate,
          paymentTerms: parsedInput.paymentTerms,
          payableLoan: parsedInput.payableLoan,
          loanTotalCredit: parsedInput.loanTotalCredit,
          amortization: parsedInput.amortization,
          loanBalance: parsedInput.loanBalance,
          status: parsedInput.status,
          loanPaymentDate: parsedInput.loanPaymentDate || null,
        // } satisfies Partial<typeof employeesLoans.$inferInsert>)
        })
        .returning({ insertedId: employeesLoans.id });

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

