const EMPLOYEE_NO_WIDTH = 5;

import {
  type EmployeeType,
  formatEmployeeCode,
  normalizeEmployeeType,
} from "@/utils/employeeCode";

export class InvalidEmployeeNoError extends Error {
  constructor(message = "Employee No must contain numbers only.") {
    super(message);
    this.name = "InvalidEmployeeNoError";
  }
}

function normalizeDigits(digits: string) {
  if (!/^[0-9]+$/.test(digits)) {
    throw new InvalidEmployeeNoError();
  }

  const withoutLeadingZeroes = digits.replace(/^0+/, "") || "0";

  if (withoutLeadingZeroes === "0") {
    throw new InvalidEmployeeNoError("Employee No must be greater than zero.");
  }

  return withoutLeadingZeroes.padStart(EMPLOYEE_NO_WIDTH, "0");
}

function incrementNumericString(value: string) {
  const digits = value.split("");
  let carry = 1;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const nextDigit = Number(digits[index]) + carry;
    digits[index] = String(nextDigit % 10);
    carry = nextDigit >= 10 ? 1 : 0;

    if (!carry) break;
  }

  if (carry) {
    digits.unshift("1");
  }

  return digits.join("").replace(/^0+/, "") || "0";
}

export function normalizeEmployeeNoForSave(
  employeeNo: string | null | undefined,
  options: { allowEmpty: true; allowLegacyPrefix?: boolean },
): string | null;
export function normalizeEmployeeNoForSave(
  employeeNo: string | null | undefined,
  options?: { allowEmpty?: false; allowLegacyPrefix?: boolean },
): string;
export function normalizeEmployeeNoForSave(
  employeeNo: string | null | undefined,
  options: { allowEmpty?: boolean; allowLegacyPrefix?: boolean } = {},
) {
  const rawEmployeeNo = employeeNo?.trim() ?? "";

  if (!rawEmployeeNo) {
    if (options.allowEmpty) return null;
    throw new InvalidEmployeeNoError("Employee No is required.");
  }

  const legacyMatch = rawEmployeeNo.match(/^EMP([0-9]+)$/i);

  if (legacyMatch) {
    if (!options.allowLegacyPrefix) {
      throw new InvalidEmployeeNoError();
    }

    return normalizeDigits(legacyMatch[1]);
  }

  return normalizeDigits(rawEmployeeNo);
}

export function formatNextEmployeeNoFromMax(maxEmployeeNo: string | null | undefined) {
  const normalizedMax = maxEmployeeNo?.trim();

  if (!normalizedMax) {
    return "00001";
  }

  if (!/^[0-9]+$/.test(normalizedMax)) {
    throw new InvalidEmployeeNoError();
  }

  const next = incrementNumericString(normalizedMax);
  return next.padStart(EMPLOYEE_NO_WIDTH, "0");
}

export function formatEmployeeCodeFromParts(args: {
  employeeType: string | null | undefined;
  employeeNo: string | null | undefined;
}) {
  return formatEmployeeCode(args);
}

export function normalizeEmployeeTypeForSave(
  employeeType: string | null | undefined,
): EmployeeType {
  return normalizeEmployeeType(employeeType);
}
