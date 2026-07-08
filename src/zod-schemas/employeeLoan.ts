import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeesLoans } from "@/db/schema";
import { stripCommas } from "@/lib/number";
import { z } from "zod";

const numericString = (label: string) =>
  z.preprocess((val) => {
    if (val == null || val === "") return "";
    if (typeof val === "number") return String(val);
    if (typeof val === "string") return stripCommas(val).trim();
    return val;
  }, z.string().min(1, `${label} is required`).regex(/^\d*\.?\d*$/, "Must be a number"));

// Insert Schema (used when adding a new employee)
export const insertEmployeeLoanSchema = createInsertSchema(employeesLoans, {
    id: z.string().uuid().optional(),
    accountCodeId: z.coerce.number().min(1,"Account Code is Required"),
    loanReferenceNumber: z.string().optional().default(""),
    amountGranted: numericString("Amount Granted"),
    payrollDateDeduction: z.string().min(1, "Payroll Date Deduction is required"),
    loanDate: z.string().min(1, "Loan Date is required"),
    termMonths: z.coerce
      .number()
      .int("Term must be a whole number of months")
      .min(1, "Term must be at least 1 month")
      .max(120, "Term cannot exceed 120 months"),
    payableLoan: numericString("Payable Loan"),
    loanTotalCredit: numericString("Loan Total Credit"),
    amortization: numericString("Amortization"),
    loanBalance: numericString("Loan Balance"),
    loanPaymentDate: z.string().optional().or(z.literal("")),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
}).extend({

});

export const employeeLoanListSchema = z.object({
    id: z.string(),
    employeeId: z.string(),
    accountCodeId: z.number().nullable(),
    loanReferenceNumber: z.string(),
    amountGranted: z.string(),
    payrollDateDeduction: z.string(),
    loanDate: z.string(),
    paymentTerms: z.string(),
    termMonths: z.number().int().min(1).max(120),
    payableLoan: z.string(),
    loanTotalCredit: z.string(),
    amortization: z.string(),
    loanBalance: z.string(),
    loanPaymentDate: z.string().nullable(),
    status: z.string(),
    employeeNo: z.string().nullable(),
    employeeType: z.string().nullable(),
    employeeFirstName: z.string().nullable(),
    employeeLastName: z.string().nullable(),
    accountCode: z.string().nullable(),
    accountCodeDescription: z.string().nullable(),
    accountCodeType: z.string().nullable(),
  });
export type EmployeeLoanList = z.infer<typeof employeeLoanListSchema>;

export const employeeLoanSummarySchema = z.object({
  totalDeducted: z.string(),
  currentBalance: z.string(),
  payableLoan: z.string(),
});

export const employeeLoanDeductionHistoryRowSchema = z.object({
  id: z.string(),
  paymentDate: z.string(),
  payrollCode: z.string().nullable(),
  installmentNo: z.number().nullable(),
  deductedAmount: z.string(),
  balanceAfter: z.string().nullable(),
});

export const employeeLoanDeductionHistoryPageSchema = z.object({
  rows: employeeLoanDeductionHistoryRowSchema.array(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalRows: z.number().int().min(0),
  totalPages: z.number().int().min(1),
});

export const employeeLoanScheduleRowSchema = z.object({
  id: z.string(),
  payrollCode: z.string(),
  dueDate: z.string(),
  installmentNo: z.number(),
  scheduledAmount: z.string(),
  balanceAfter: z.string().nullable(),
  status: z.enum(["Pending", "Due", "Paid", "Skipped", "Void"]),
  skippedAt: z.date().nullable(),
  skipReason: z.string().nullable(),
});

export const employeeLoanScheduleSchema = employeeLoanScheduleRowSchema.array();

export const skipLoanInstallmentSchema = z.object({
  loanId: z.string().uuid(),
  installmentId: z.string().uuid(),
  skipReason: z.string().trim().min(1, "Skip reason is required").max(500),
});

// Select Schema (used when retrieving an employee from the database)
export const selectEmployeeLoanSchema = createSelectSchema(employeesLoans);

export const selectEmployeeLoanWithRelationsSchema = selectEmployeeLoanSchema.extend({
});

// Types
export type InsertEmployeeLoanSchemaType = z.infer<typeof insertEmployeeLoanSchema>;
export type SelectEmployeeLoanSchemaType = z.infer<typeof selectEmployeeLoanWithRelationsSchema>;
export type EmployeeLoanSummary = z.infer<typeof employeeLoanSummarySchema>;
export type EmployeeLoanDeductionHistoryRow = z.infer<
  typeof employeeLoanDeductionHistoryRowSchema
>;
export type EmployeeLoanDeductionHistoryPage = z.infer<
  typeof employeeLoanDeductionHistoryPageSchema
>;
export type EmployeeLoanScheduleRow = z.infer<typeof employeeLoanScheduleRowSchema>;
export type SkipLoanInstallmentInput = z.infer<typeof skipLoanInstallmentSchema>;
