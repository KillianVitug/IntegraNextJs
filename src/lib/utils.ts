import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getCurrentYear(): number {
  return new Date().getFullYear();
}

export type PayrollCodeCycle = {
  code: string;
  cycle: "A" | "B";
  period: string;
  start: string;
  end: string;
  nominalPayDate: string;
  adjustedPayDate: string;
  label: string;
  displayText: string;
};

function createUtcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

function formatDateOnly(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function moveToPreviousWorkingDay(date: Date) {
  const adjusted = new Date(date.getTime());

  // Weekend-only fallback for now. Holiday support can plug into this later.
  while (adjusted.getUTCDay() === 0 || adjusted.getUTCDay() === 6) {
    adjusted.setUTCDate(adjusted.getUTCDate() - 1);
  }

  return adjusted;
}

function buildPayrollCodeCycle(
  code: string,
  cycle: "A" | "B",
  start: string,
  end: string,
  nominalPayDate: Date
): PayrollCodeCycle {
  const nominalPayDateString = formatDateOnly(nominalPayDate);
  const adjustedPayDateString = formatDateOnly(
    moveToPreviousWorkingDay(nominalPayDate)
  );
  const period = `${start} to ${end}`;
  const displayText = `${code} | ${period} | Pay Date: ${adjustedPayDateString}`;

  return {
    code,
    cycle,
    period,
    start,
    end,
    nominalPayDate: nominalPayDateString,
    adjustedPayDate: adjustedPayDateString,
    label: displayText,
    displayText,
  };
}

export function generatePayrollCodes(
  year: number,
  month: number
): PayrollCodeCycle[] {
  const monthStr = String(month).padStart(2, "0");
  const startA = formatDateOnly(createUtcDate(year, month - 1, 1));
  const endA = formatDateOnly(createUtcDate(year, month - 1, 15));
  const startB = formatDateOnly(createUtcDate(year, month - 1, 16));
  const endB = formatDateOnly(createUtcDate(year, month, 0));

  return [
    buildPayrollCodeCycle(
      `${year}-${monthStr}-A`,
      "A",
      startA,
      endA,
      createUtcDate(year, month - 1, 20)
    ),
    buildPayrollCodeCycle(
      `${year}-${monthStr}-B`,
      "B",
      startB,
      endB,
      createUtcDate(year, month, 5)
    ),
  ];
}

export function getPayrollCodeDetails(payrollCode: string) {
  const match = /^(\d{4})-(\d{2})-([AB])$/.exec(payrollCode);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const cycle = match[3] as "A" | "B";

  return (
    generatePayrollCodes(year, month).find((entry) => entry.cycle === cycle) ??
    null
  );
}
