import { z } from "zod";

export const manualPayrollLineSummaryBuckets = [
  "basicPay",
  "otPaidLeaves",
  "otherIncome",
  "month13th",
  "nonTaxable",
  "deminimis",
  "otherDeductions",
] as const;

export const manualPayrollLineTypes = [
  "Earning",
  "Deduction",
  "Employer Contribution",
  "Information",
] as const;

function optionalMoney(max = 999999999) {
  return z.preprocess(
    (value) => (value === "" || value == null ? "0" : value),
    z.coerce.number().min(0).max(max)
  );
}

export const saveManualPayrollEntrySchema = z.object({
  payrollPeriodId: z.string().uuid(),
  employeeId: z.string().uuid(),
  sssEmployee: optionalMoney(),
  sssEmployer: optionalMoney(),
  sssEc: optionalMoney(),
  sssBasis: optionalMoney(),
  philhealthEmployee: optionalMoney(),
  philhealthEmployer: optionalMoney(),
  philhealthBasis: optionalMoney(),
  pagibigEmployee: optionalMoney(),
  pagibigEmployer: optionalMoney(),
  pagibigBasis: optionalMoney(),
  withholdingTax: optionalMoney(),
  withholdingTaxBasis: optionalMoney(),
  peraaEmployee: optionalMoney(),
  peraaEmployer: optionalMoney(),
  peraaBasis: optionalMoney(),
  remarks: z.string().trim().max(1000).optional().nullable(),
  lines: z
    .array(
      z.object({
        id: z.string().uuid().optional().nullable(),
        accountCodeId: z.coerce.number().int().positive().nullable().optional(),
        lineType: z.enum(manualPayrollLineTypes),
        summaryBucket: z.enum(manualPayrollLineSummaryBuckets),
        code: z.string().trim().min(1).max(50),
        description: z.string().trim().min(1).max(150),
        loanRefNo: z.string().trim().max(80).optional().nullable(),
        hours: z.coerce.number().int().min(0).max(999).optional(),
        minutes: z.coerce.number().int().min(0).max(59).optional(),
        amount: optionalMoney(),
        taxable: z.boolean().optional(),
        month13thEligible: z.boolean().optional(),
        nonTaxable: z.boolean().optional(),
        deminimis: z.boolean().optional(),
        sourceTable: z.string().trim().max(50).optional().nullable(),
        sourceId: z.string().trim().max(50).optional().nullable(),
        sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
      })
    )
    .max(200),
});

export const deleteManualPayrollEntrySchema = z.object({
  payrollPeriodId: z.string().uuid(),
  employeeId: z.string().uuid(),
});

export type SaveManualPayrollEntrySchemaType = z.infer<
  typeof saveManualPayrollEntrySchema
>;

export type DeleteManualPayrollEntrySchemaType = z.infer<
  typeof deleteManualPayrollEntrySchema
>;
