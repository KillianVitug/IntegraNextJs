import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeesLoans, employees } from "@/db/schema";
import { z } from "zod";


// Insert Schema (used when adding a new employee)
export const insertEmployeeLoanSchema = createInsertSchema(employeesLoans, {
    id: z.string().uuid().optional(),
    accountCodeId: z.coerce.number().min(1,"Account Code is Required"),
    loanReferenceNumber: z.string().min(1, "Loan Reference Number is required"),
    amountGranted: z.string().min(1, "Amount Granted is required"),
    payrollDateDeduction: z.string().min(1, "Payroll Date Deduction is required"),
    loanDate: z.string().min(1, "Loan Date is required"),
    payableLoan: z.string().min(1, "Payable Loan is required"),
    loanTotalCredit: z.string().min(1, "Loan Total Credit is required"),
    amortization: z.string().min(1, "Amortization is required"),
    loanPaymentDate: z.string().optional().or(z.literal("")),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
}).extend({

});

// Select Schema (used when retrieving an employee from the database)
export const selectEmployeeLoanSchema = createSelectSchema(employeesLoans);

export const selectEmployeeLoanWithRelationsSchema = selectEmployeeLoanSchema.extend({
});

// Types
export type InsertEmployeeLoanSchemaType = z.infer<typeof insertEmployeeLoanSchema>;
export type SelectEmployeeLoanSchemaType = z.infer<typeof selectEmployeeLoanWithRelationsSchema>;
