import { roundDtrOvertimeMinutes } from "./dtrRounding";

export const overtimeCategoryValues = [
  "REGULAR_DAY",
  "REST_DAY",
  "REGULAR_HOLIDAY",
  "REST_DAY_REGULAR_HOLIDAY",
  "SPECIAL_NON_WORKING_HOLIDAY",
  "REST_DAY_SPECIAL_NON_WORKING_HOLIDAY",
] as const;

export type OvertimeCategory = (typeof overtimeCategoryValues)[number];

export type OvertimeHolidayType =
  | "Regular"
  | "Special Non-Working"
  | "Special Working"
  | "Company";

export const WORKED_HOURS_OT_THRESHOLD_MINUTES = 8 * 60;

export const OVERTIME_CATEGORY_LABELS: Record<OvertimeCategory, string> = {
  REGULAR_DAY: "Regular Day",
  REST_DAY: "Rest Day",
  REGULAR_HOLIDAY: "Regular Holiday",
  REST_DAY_REGULAR_HOLIDAY: "Rest Day + Regular Holiday",
  SPECIAL_NON_WORKING_HOLIDAY: "Special Non-Working Holiday",
  REST_DAY_SPECIAL_NON_WORKING_HOLIDAY: "Rest Day + Special Non-Working Holiday",
};

type HolidayRangeLike = {
  holidayDate: string;
  holidayDate2?: string | null;
  holidayType: OvertimeHolidayType;
};

type OvertimeRuleLike = {
  category: OvertimeCategory;
  minutesFrom: number;
  minutesTo: number | null;
  rateMultiplier: number | string;
};

function toAmount(value: number | string | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundMoney(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getHolidayPriority(holidayType: OvertimeHolidayType) {
  if (holidayType === "Regular") return 4;
  if (holidayType === "Special Non-Working") return 3;
  if (holidayType === "Company") return 2;
  return 1;
}

export function getOvertimeCategoryLabel(category: OvertimeCategory) {
  return OVERTIME_CATEGORY_LABELS[category];
}

export function buildHolidayTypeByDate(holidays: HolidayRangeLike[]) {
  const holidayTypeByDate = new Map<string, OvertimeHolidayType>();

  for (const holiday of holidays) {
    const start = parseDateOnly(holiday.holidayDate);
    const end = parseDateOnly(holiday.holidayDate2 ?? holiday.holidayDate);
    const cursor = new Date(start.getTime());

    while (cursor <= end) {
      const dateKey = formatDateOnly(cursor);
      const existing = holidayTypeByDate.get(dateKey);

      if (
        !existing ||
        getHolidayPriority(holiday.holidayType) > getHolidayPriority(existing)
      ) {
        holidayTypeByDate.set(dateKey, holiday.holidayType);
      }

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return holidayTypeByDate;
}

export function resolveOvertimeCategory(args: {
  isRestDay: boolean;
  holidayType?: OvertimeHolidayType | null;
}): OvertimeCategory {
  if (args.holidayType === "Regular") {
    return args.isRestDay ? "REST_DAY_REGULAR_HOLIDAY" : "REGULAR_HOLIDAY";
  }

  if (
    args.holidayType === "Special Non-Working" ||
    args.holidayType === "Company"
  ) {
    return args.isRestDay
      ? "REST_DAY_SPECIAL_NON_WORKING_HOLIDAY"
      : "SPECIAL_NON_WORKING_HOLIDAY";
  }

  return args.isRestDay ? "REST_DAY" : "REGULAR_DAY";
}

export function findMatchingOvertimeRule<T extends OvertimeRuleLike>(
  rules: T[],
  category: OvertimeCategory,
  minutes: number
) {
  return rules.find((rule) => {
    if (rule.category !== category) return false;
    if (minutes < rule.minutesFrom) return false;
    if (rule.minutesTo != null && minutes > rule.minutesTo) return false;
    return true;
  }) ?? null;
}

export function resolveApprovedOvertimeMinutes(args: {
  isApproved: boolean;
  manualMinutes?: number | null;
  computedMinutes: number;
}) {
  if (!args.isApproved) return 0;
  return Math.max(0, args.manualMinutes ?? args.computedMinutes);
}

export function resolveDetectedOvertimeMinutes(args: {
  scheduleOvertimeMinutes: number;
  effectiveWorkedMinutes: number;
}) {
  const detectedMinutes = Math.max(
    0,
    args.scheduleOvertimeMinutes,
    args.effectiveWorkedMinutes - WORKED_HOURS_OT_THRESHOLD_MINUTES
  );

  return roundDtrOvertimeMinutes(detectedMinutes);
}

export function computeOvertimeCompensation(args: {
  approvedMinutes: number;
  dailyRate: number;
  scheduledMinutes: number;
  fallbackHoursPerDay: number;
  rateMultiplier: number | string;
}) {
  const hoursPerDay =
    args.scheduledMinutes > 0
      ? args.scheduledMinutes / 60
      : args.fallbackHoursPerDay > 0
        ? args.fallbackHoursPerDay
        : 8;
  const baseHourlyRate =
    hoursPerDay > 0 ? roundMoney(args.dailyRate / hoursPerDay) : 0;
  const overtimeRate = roundMoney(baseHourlyRate * toAmount(args.rateMultiplier));
  const amount = roundMoney((Math.max(0, args.approvedMinutes) / 60) * overtimeRate);

  return {
    hoursPerDay,
    baseHourlyRate,
    overtimeRate,
    amount,
  };
}
