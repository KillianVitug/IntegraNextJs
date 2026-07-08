export type SupportedPayrollTerms = "Semi-Monthly";

export type PayrollCycle = "A" | "B";

export type PayrollPeriodSeed = {
  code: string;
  payrollTerms: "Semi-Monthly";
  cycle: PayrollCycle;
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  nominalPayDate: string;
  adjustedPayDate: string;
};

export type HolidayLike = {
  holidayDate: string;
  holidayDate2?: string | null;
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

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return createUtcDate(year, month - 1, day);
}

function isWeekend(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function expandHolidayDateRange(holiday: HolidayLike) {
  const start = parseDateOnly(holiday.holidayDate);
  const end = parseDateOnly(holiday.holidayDate2 ?? holiday.holidayDate);
  const dates: string[] = [];
  const cursor = new Date(start.getTime());

  while (cursor <= end) {
    dates.push(formatDateOnly(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export function buildHolidayDateSet(holidays: HolidayLike[]) {
  return new Set(holidays.flatMap((holiday) => expandHolidayDateRange(holiday)));
}

export function adjustPayDate(
  nominalPayDate: Date,
  holidays: HolidayLike[] = []
) {
  const holidaySet = buildHolidayDateSet(holidays);
  const adjusted = new Date(nominalPayDate.getTime());

  while (isWeekend(adjusted) || holidaySet.has(formatDateOnly(adjusted))) {
    adjusted.setUTCDate(adjusted.getUTCDate() - 1);
  }

  return adjusted;
}

function buildPeriodSeed(
  year: number,
  month: number,
  cycle: PayrollCycle,
  startDate: Date,
  endDate: Date,
  nominalPayDate: Date,
  holidays: HolidayLike[]
): PayrollPeriodSeed {
  const monthStr = String(month).padStart(2, "0");
  return {
    code: `${year}-${monthStr}-${cycle}`,
    payrollTerms: "Semi-Monthly",
    cycle,
    year,
    month,
    startDate: formatDateOnly(startDate),
    endDate: formatDateOnly(endDate),
    nominalPayDate: formatDateOnly(nominalPayDate),
    adjustedPayDate: formatDateOnly(adjustPayDate(nominalPayDate, holidays)),
  };
}

export function getSemiMonthlyPayrollPeriods(
  year: number,
  month: number,
  holidays: HolidayLike[] = []
) {
  const firstHalfStart = createUtcDate(year, month - 1, 1);
  const firstHalfEnd = createUtcDate(year, month - 1, 15);
  const secondHalfStart = createUtcDate(year, month - 1, 16);
  const secondHalfEnd = createUtcDate(year, month, 0);

  return [
    buildPeriodSeed(
      year,
      month,
      "A",
      firstHalfStart,
      firstHalfEnd,
      createUtcDate(year, month - 1, 20),
      holidays
    ),
    buildPeriodSeed(
      year,
      month,
      "B",
      secondHalfStart,
      secondHalfEnd,
      createUtcDate(year, month, 5),
      holidays
    ),
  ];
}

export function getCalendarYearSeeds(
  year: number,
  holidays: HolidayLike[] = []
) {
  return Array.from({ length: 12 }, (_, index) =>
    getSemiMonthlyPayrollPeriods(year, index + 1, holidays)
  ).flat();
}

export function parsePayrollCode(code: string) {
  const match = /^(\d{4})-(\d{2})-([AB])$/.exec(code);

  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    cycle: match[3] as PayrollCycle,
  };
}

export function getNextSemiMonthlyCode(code: string) {
  const parsed = parsePayrollCode(code);
  if (!parsed) return null;

  if (parsed.cycle === "A") {
    return `${parsed.year}-${String(parsed.month).padStart(2, "0")}-B`;
  }

  const nextMonth = parsed.month === 12 ? 1 : parsed.month + 1;
  const nextYear = parsed.month === 12 ? parsed.year + 1 : parsed.year;

  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-A`;
}

export function getPeriodByCode(
  code: string,
  holidays: HolidayLike[] = []
) {
  const parsed = parsePayrollCode(code);
  if (!parsed) return null;

  return (
    getSemiMonthlyPayrollPeriods(parsed.year, parsed.month, holidays).find(
      (period) => period.cycle === parsed.cycle
    ) ?? null
  );
}
