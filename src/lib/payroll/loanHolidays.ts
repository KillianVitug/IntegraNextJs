import { fetchConfirmedHolidayRowsForRange } from "@/lib/holidays";
import { parsePayrollCode, type HolidayLike } from "./calendar";

const LOAN_SCHEDULE_YEAR_SPAN = 11;
const holidayCache = new Map<string, Promise<HolidayLike[]>>();

export function getLoanHolidayRangeForPayrollCode(firstPayrollCode: string) {
  const parsed = parsePayrollCode(firstPayrollCode);
  const startYear = parsed?.year ?? new Date().getFullYear();
  const endYear = startYear + LOAN_SCHEDULE_YEAR_SPAN;

  return {
    startDate: `${startYear}-01-01`,
    endDate: `${endYear}-12-31`,
  };
}

export async function fetchLoanScheduleHolidays(
  firstPayrollCode: string
): Promise<HolidayLike[]> {
  const range = getLoanHolidayRangeForPayrollCode(firstPayrollCode);
  const cacheKey = `${range.startDate}:${range.endDate}`;

  const cached = holidayCache.get(cacheKey);
  if (cached) return cached;

  const promise = fetchConfirmedHolidayRowsForRange(
    range.startDate,
    range.endDate
  );
  holidayCache.set(cacheKey, promise);

  return promise;
}
