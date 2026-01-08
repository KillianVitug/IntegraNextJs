import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getCurrentYear(): number {
  return new Date().getFullYear();
}

export function generatePayrollCodes(year: number, month: number) {
  const monthStr = String(month).padStart(2, "0");
  const startA = `${year}-${monthStr}-01`;
  const endA = `${year}-${monthStr}-15`;
  const startB = `${year}-${monthStr}-16`;
  const endB = new Date(year, month, 0).toISOString().slice(0, 10); // last day of month

  return [
    {
      code: `${year}-${monthStr}-A`,
      period: `${startA} to ${endA}`,
      start: startA,
      end: endA,
    },
    {
      code: `${year}-${monthStr}-B`,
      period: `${startB} to ${endB}`,
      start: startB,
      end: endB,
    },
  ];
}