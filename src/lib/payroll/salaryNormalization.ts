import type { employeesSalary } from "@/db/schema";
import type { InsertEmployeeSalarySchemaType } from "@/zod-schemas/employeeSalary";

type SalaryInput = Partial<InsertEmployeeSalarySchemaType>;
type EmployeeSalaryInsert = typeof employeesSalary.$inferInsert;
type NormalizedSalaryForDb = Partial<
  Omit<EmployeeSalaryInsert, "employeeId" | "id">
>;

function normalizeDecimalString(value: unknown, maxDecimalPlaces: number) {
  if (value === "" || value === null || value === undefined) return null;

  const normalized = String(value).replace(/,/g, "").trim();
  if (!/^\d*\.?\d*$/.test(normalized) || normalized === ".") return null;

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue)) return null;

  const decimalPlaces = normalized.split(".")[1]?.length ?? 0;
  if (decimalPlaces > maxDecimalPlaces) {
    throw new Error(`Expected at most ${maxDecimalPlaces} decimal places.`);
  }

  return normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
}

function normalizeFixedDecimalString(
  value: unknown,
  maxDecimalPlaces: number,
  fixedDecimalPlaces: number,
) {
  const normalized = normalizeDecimalString(value, maxDecimalPlaces);
  return normalized == null
    ? null
    : Number(normalized).toFixed(fixedDecimalPlaces);
}

function normalizeIntegerId(
  value: unknown,
  options: {
    fieldLabel: string;
    minValue: number;
    zeroAsNull?: boolean;
  },
) {
  if (value === "" || value === null || value === undefined) return null;

  const normalized = typeof value === "string" ? value.trim() : String(value);
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${options.fieldLabel} must be an integer id.`);
  }

  const numericValue = Number(normalized);
  if (!Number.isSafeInteger(numericValue)) {
    throw new Error(`${options.fieldLabel} must be a safe integer id.`);
  }

  if (options.zeroAsNull && numericValue === 0) return null;

  if (numericValue < options.minValue) {
    throw new Error(`${options.fieldLabel} must be ${options.minValue} or greater.`);
  }

  return numericValue;
}

export function normalizeSalaryForDb(salary: SalaryInput): NormalizedSalaryForDb {
  const normalizedSalary: NormalizedSalaryForDb = {};

  for (const [key, value] of Object.entries(salary) as [
    keyof SalaryInput,
    SalaryInput[keyof SalaryInput],
  ][]) {
    if (key === "id" || key === "employeeId") continue;

    if (
      key === "ignoreDtrForMonthlyRate" ||
      key === "ignoreContributionDeduction"
    ) {
      normalizedSalary[key] = value === true || value === "true";
      continue;
    }

    if (key === "slvlGroupId") {
      normalizedSalary.slvlGroupId = normalizeIntegerId(value, {
        fieldLabel: "SLVL Group",
        minValue: 0,
      });
      continue;
    }

    if (key === "customPayrollId") {
      normalizedSalary.customPayrollId = normalizeIntegerId(value, {
        fieldLabel: "Custom Payroll Code",
        minValue: 1,
        zeroAsNull: true,
      });
      continue;
    }

    if (key === "customPayrollDescription") {
      normalizedSalary.customPayrollDescription =
        value == null ? null : String(value);
      continue;
    }

    switch (key) {
      case "dailyRate":
        normalizedSalary.dailyRate = normalizeDecimalString(value, 4);
        break;
      case "monthlyRate":
        normalizedSalary.monthlyRate = normalizeDecimalString(value, 4);
        break;
      case "monthlyAllowance":
        normalizedSalary.monthlyAllowance = normalizeFixedDecimalString(
          value,
          2,
          2,
        );
        break;
      case "dailyAllowance":
        normalizedSalary.dailyAllowance = normalizeFixedDecimalString(
          value,
          2,
          2,
        );
        break;
      case "cola":
        normalizedSalary.cola = normalizeFixedDecimalString(value, 2, 2);
        break;
      case "rateDivisor":
        normalizedSalary.rateDivisor = normalizeFixedDecimalString(
          value,
          2,
          2,
        );
        break;
      case "billingRate":
        normalizedSalary.billingRate = normalizeFixedDecimalString(
          value,
          2,
          2,
        );
        break;
    }
  }

  return normalizedSalary;
}
