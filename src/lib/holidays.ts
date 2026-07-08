import "server-only";

import { db } from "@/db";
import {
  holidayTemplates,
  holidayYearCalendar,
  payrollPeriods,
  payrollRuns,
} from "@/db/schema";
import { buildHolidayCheckDateBackfillUpdates } from "@/lib/holidayCheckDates";
import { getCalendarYearSeeds, type HolidayLike } from "@/lib/payroll/calendar";
import Holidays, { type HolidaysTypes } from "date-holidays";
import { and, asc, eq, isNotNull, lte, ne, sql } from "drizzle-orm";

type HolidayTemplateRow = typeof holidayTemplates.$inferSelect;
type HolidayYearInsert = typeof holidayYearCalendar.$inferInsert;
type ConfirmedHolidayRow = {
  holidayDate: string;
  holidayDate2: string | null;
  checkDate1: string | null;
  checkDate2: string | null;
  requireCheckDate1: boolean;
  requireCheckDate2: boolean;
  holidayType: typeof holidayYearCalendar.$inferSelect["holidayType"];
};

export type HolidayYearGenerationResult = {
  created: number;
  skipped: number;
  templateCreated: number;
  templateSkipped: number;
  packageCreated: number;
  packageSkipped: number;
  checkDateBackfilled: number;
  needsReview: number;
  updatedPayrollPeriods: number;
  skippedPayrollPeriods: number;
};

export type PayrollPeriodHolidayRefreshResult = {
  updatedPayrollPeriods: number;
  skippedPayrollPeriods: number;
};

const PACKAGE_HOLIDAY_COUNTRY = "PH";
const PACKAGE_HOLIDAY_TIMEZONE = "Asia/Manila";
const PACKAGE_HOLIDAY_LANGUAGES = ["en"];
const PACKAGE_HOLIDAY_TYPES: HolidaysTypes.HolidayType[] = [
  "public",
  "bank",
  "optional",
  "school",
  "observance",
];
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function createUtcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return createUtcDate(year, month, day);
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isValidMonthDay(year: number, month: number, day: number) {
  const date = createUtcDate(year, month, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function getNthWeekdayDate(
  year: number,
  month: number,
  weekday: number,
  occurrence: number
) {
  if (occurrence === -1) {
    const cursor = new Date(Date.UTC(year, month, 0));
    while (cursor.getUTCDay() !== weekday) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return cursor;
  }

  const cursor = createUtcDate(year, month, 1);
  while (cursor.getUTCDay() !== weekday) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  cursor.setUTCDate(cursor.getUTCDate() + (occurrence - 1) * 7);
  return cursor.getUTCMonth() === month - 1 ? cursor : null;
}

function buildHolidayEndDate(startDate: string | null, durationDays: number) {
  if (!startDate || durationDays <= 1) return null;
  return formatDateOnly(addDays(parseDateOnly(startDate), durationDays - 1));
}

function normalizeHolidayName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildHolidayDuplicateKey(
  row: Pick<HolidayYearInsert, "name" | "holidayDate">
) {
  if (!row.holidayDate) return null;
  return `${normalizeHolidayName(row.name)}|${row.holidayDate}`;
}

function isDateOnlyInYear(value: string, year: number) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) === year;
}

function mapPackageHolidayType(
  type: HolidaysTypes.HolidayType
): HolidayYearInsert["holidayType"] | null {
  if (type === "public" || type === "bank") return "Regular";
  if (type === "optional") return "Special Non-Working";
  return null;
}

function getPackageHolidayDurationDays(holiday: HolidaysTypes.Holiday) {
  const durationMs = holiday.end.getTime() - holiday.start.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  return Math.max(1, Math.round(durationMs / DAY_IN_MS));
}

function buildPackageHolidayNotes(holiday: HolidaysTypes.Holiday) {
  const notes = [`date-holidays ${PACKAGE_HOLIDAY_COUNTRY} type: ${holiday.type}`];
  if (holiday.substitute) notes.push("substitute day");
  if (holiday.rule) notes.push(`rule: ${holiday.rule}`);
  return notes.join("; ");
}

export function buildGeneratedHolidayFromTemplate(
  template: HolidayTemplateRow,
  year: number
): HolidayYearInsert {
  const durationDays = Math.max(1, template.durationDays ?? 1);
  let holidayDate: string | null = null;

  if (
    template.recurrenceType === "FixedDate" &&
    template.fixedMonth != null &&
    template.fixedDay != null &&
    isValidMonthDay(year, template.fixedMonth, template.fixedDay)
  ) {
    holidayDate = formatDateOnly(
      createUtcDate(year, template.fixedMonth, template.fixedDay)
    );
  }

  if (
    template.recurrenceType === "NthWeekday" &&
    template.nthMonth != null &&
    template.nthWeekday != null &&
    template.nthOccurrence != null
  ) {
    const nthDate = getNthWeekdayDate(
      year,
      template.nthMonth,
      template.nthWeekday,
      template.nthOccurrence
    );
    holidayDate = nthDate ? formatDateOnly(nthDate) : null;
  }

  return {
    year,
    templateId: template.id,
    source: "Generated",
    name: template.name,
    holidayDate,
    holidayDate2: buildHolidayEndDate(holidayDate, durationDays),
    holidayType: template.holidayType,
    isPaid: template.isPaid,
    status: holidayDate ? "Confirmed" : "Draft",
    notes: template.notes,
    generatedAt: new Date(),
  };
}

export function buildGeneratedHolidaysFromPackage(year: number): HolidayYearInsert[] {
  const holidayProvider = new Holidays(PACKAGE_HOLIDAY_COUNTRY, {
    timezone: PACKAGE_HOLIDAY_TIMEZONE,
    languages: PACKAGE_HOLIDAY_LANGUAGES,
    types: PACKAGE_HOLIDAY_TYPES,
  });
  const generatedAt = new Date();

  return holidayProvider.getHolidays(year, "en").flatMap((holiday) => {
    const holidayType = mapPackageHolidayType(holiday.type);
    if (!holidayType) return [];

    const holidayDate = holiday.date.slice(0, 10);
    if (!isDateOnlyInYear(holidayDate, year)) return [];

    const name = holiday.name.trim() || "Package holiday";
    const durationDays = getPackageHolidayDurationDays(holiday);

    return [
      {
        year,
        templateId: null,
        source: "Package",
        name,
        holidayDate,
        holidayDate2: buildHolidayEndDate(holidayDate, durationDays),
        holidayType,
        isPaid: true,
        status: "Confirmed",
        notes: buildPackageHolidayNotes(holiday),
        generatedAt,
      } satisfies HolidayYearInsert,
    ];
  });
}

export async function fetchHolidayTemplates() {
  return db
    .select()
    .from(holidayTemplates)
    .orderBy(asc(holidayTemplates.name), asc(holidayTemplates.id));
}

export async function fetchHolidayYearCalendar(year?: number) {
  const query = db
    .select()
    .from(holidayYearCalendar)
    .$dynamic()
    .orderBy(
      asc(holidayYearCalendar.year),
      sql`${holidayYearCalendar.holidayDate} asc nulls last`,
      asc(holidayYearCalendar.name)
    );

  if (year) {
    return query.where(eq(holidayYearCalendar.year, year));
  }

  return query;
}

export async function fetchConfirmedHolidayRowsForYear(
  year: number
): Promise<ConfirmedHolidayRow[]> {
  const rows = await db
    .select({
      holidayDate: holidayYearCalendar.holidayDate,
      holidayDate2: holidayYearCalendar.holidayDate2,
      checkDate1: holidayYearCalendar.checkDate1,
      checkDate2: holidayYearCalendar.checkDate2,
      requireCheckDate1: holidayYearCalendar.requireCheckDate1,
      requireCheckDate2: holidayYearCalendar.requireCheckDate2,
      holidayType: holidayYearCalendar.holidayType,
    })
    .from(holidayYearCalendar)
    .where(
      and(
        eq(holidayYearCalendar.year, year),
        eq(holidayYearCalendar.status, "Confirmed"),
        isNotNull(holidayYearCalendar.holidayDate)
      )
    )
    .orderBy(asc(holidayYearCalendar.holidayDate));

  return rows.filter((row): row is ConfirmedHolidayRow => row.holidayDate != null);
}

export async function fetchConfirmedHolidayRowsForRange(
  startDate: string,
  endDate: string
): Promise<ConfirmedHolidayRow[]> {
  const rows = await db
    .select({
      holidayDate: holidayYearCalendar.holidayDate,
      holidayDate2: holidayYearCalendar.holidayDate2,
      checkDate1: holidayYearCalendar.checkDate1,
      checkDate2: holidayYearCalendar.checkDate2,
      requireCheckDate1: holidayYearCalendar.requireCheckDate1,
      requireCheckDate2: holidayYearCalendar.requireCheckDate2,
      holidayType: holidayYearCalendar.holidayType,
    })
    .from(holidayYearCalendar)
    .where(
      and(
        eq(holidayYearCalendar.status, "Confirmed"),
        isNotNull(holidayYearCalendar.holidayDate),
        lte(holidayYearCalendar.holidayDate, endDate),
        sql`coalesce(${holidayYearCalendar.holidayDate2}, ${holidayYearCalendar.holidayDate}) >= ${startDate}`
      )
    )
    .orderBy(asc(holidayYearCalendar.holidayDate));

  return rows.filter((row): row is ConfirmedHolidayRow => row.holidayDate != null);
}

export async function refreshOpenPayrollPeriodsForHolidayYear(
  year: number
): Promise<PayrollPeriodHolidayRefreshResult> {
  const holidays = await fetchConfirmedHolidayRowsForYear(year);
  const seeds = getCalendarYearSeeds(year, holidays as HolidayLike[]);
  const seedByCode = new Map(seeds.map((seed) => [seed.code, seed]));

  const [periodRows, runRows] = await Promise.all([
    db
      .select()
      .from(payrollPeriods)
      .where(eq(payrollPeriods.year, year))
      .orderBy(asc(payrollPeriods.startDate)),
    db
      .select({ payrollPeriodId: payrollRuns.payrollPeriodId })
      .from(payrollRuns)
      .innerJoin(payrollPeriods, eq(payrollRuns.payrollPeriodId, payrollPeriods.id))
      .where(
        and(eq(payrollPeriods.year, year), ne(payrollRuns.status, "Void"))
      ),
  ]);

  const periodIdsWithRuns = new Set(
    runRows.map((row) => row.payrollPeriodId).filter(Boolean)
  );
  let updatedPayrollPeriods = 0;
  let skippedPayrollPeriods = 0;

  for (const period of periodRows) {
    const seed = seedByCode.get(period.code);
    if (!seed || period.adjustedPayDate === seed.adjustedPayDate) continue;

    if (period.status !== "Open" || periodIdsWithRuns.has(period.id)) {
      skippedPayrollPeriods += 1;
      continue;
    }

    await db
      .update(payrollPeriods)
      .set({
        adjustedPayDate: seed.adjustedPayDate,
        updatedAt: new Date(),
      })
      .where(eq(payrollPeriods.id, period.id));
    updatedPayrollPeriods += 1;
  }

  return { updatedPayrollPeriods, skippedPayrollPeriods };
}

export async function generateHolidayYearFromTemplates(
  year: number
): Promise<HolidayYearGenerationResult> {
  const [templates, existingRows] = await Promise.all([
    db
      .select()
      .from(holidayTemplates)
      .where(eq(holidayTemplates.isActive, true))
      .orderBy(asc(holidayTemplates.name)),
    db
      .select({ templateId: holidayYearCalendar.templateId })
      .from(holidayYearCalendar)
      .where(
        and(
          eq(holidayYearCalendar.year, year),
          isNotNull(holidayYearCalendar.templateId)
        )
      ),
  ]);

  const existingTemplateIds = new Set(
    existingRows.map((row) => row.templateId).filter((id): id is number => id != null)
  );
  const templateRowsToCreate = templates
    .filter((template) => !existingTemplateIds.has(template.id))
    .map((template) => buildGeneratedHolidayFromTemplate(template, year));

  if (templateRowsToCreate.length > 0) {
    await db
      .insert(holidayYearCalendar)
      .values(templateRowsToCreate)
      .onConflictDoNothing();
  }

  const packageCandidateRows = buildGeneratedHolidaysFromPackage(year);
  const existingHolidayRows = await db
    .select({
      name: holidayYearCalendar.name,
      holidayDate: holidayYearCalendar.holidayDate,
    })
    .from(holidayYearCalendar)
    .where(
      and(
        eq(holidayYearCalendar.year, year),
        isNotNull(holidayYearCalendar.holidayDate)
      )
    );

  const existingHolidayKeys = new Set(
    existingHolidayRows
      .map((row) => buildHolidayDuplicateKey(row))
      .filter((key): key is string => key != null)
  );
  const packageRowsToCreate = packageCandidateRows.filter((row) => {
    const key = buildHolidayDuplicateKey(row);
    if (!key || existingHolidayKeys.has(key)) return false;
    existingHolidayKeys.add(key);
    return true;
  });

  if (packageRowsToCreate.length > 0) {
    await db
      .insert(holidayYearCalendar)
      .values(packageRowsToCreate)
      .onConflictDoNothing();
  }

  const checkDateBackfilled = await backfillHolidayCheckDatesForYear(year);
  const refreshResult = await refreshOpenPayrollPeriodsForHolidayYear(year);
  const templateCreated = templateRowsToCreate.length;
  const templateSkipped = templates.length - templateCreated;
  const packageCreated = packageRowsToCreate.length;
  const packageSkipped = packageCandidateRows.length - packageCreated;

  return {
    created: templateCreated + packageCreated,
    skipped: templateSkipped + packageSkipped,
    templateCreated,
    templateSkipped,
    packageCreated,
    packageSkipped,
    checkDateBackfilled,
    needsReview: templateRowsToCreate.filter(
      (row) => row.status === "Draft" || !row.holidayDate
    ).length,
    ...refreshResult,
  };
}

export async function backfillHolidayCheckDatesForYear(year: number) {
  const rows = await db
    .select({
      id: holidayYearCalendar.id,
      holidayDate: holidayYearCalendar.holidayDate,
      holidayDate2: holidayYearCalendar.holidayDate2,
      checkDate1: holidayYearCalendar.checkDate1,
      checkDate2: holidayYearCalendar.checkDate2,
      requireCheckDate1: holidayYearCalendar.requireCheckDate1,
      requireCheckDate2: holidayYearCalendar.requireCheckDate2,
    })
    .from(holidayYearCalendar)
    .where(
      and(
        eq(holidayYearCalendar.year, year),
        eq(holidayYearCalendar.status, "Confirmed"),
        isNotNull(holidayYearCalendar.holidayDate)
      )
    )
    .orderBy(asc(holidayYearCalendar.holidayDate), asc(holidayYearCalendar.id));

  const updates = buildHolidayCheckDateBackfillUpdates(rows);
  let updatedCount = 0;

  for (const update of updates) {
    const { id, ...updatePayload } = update;
    await db
      .update(holidayYearCalendar)
      .set({ ...updatePayload, updatedAt: new Date() })
      .where(eq(holidayYearCalendar.id, Number(id)));
    updatedCount += 1;
  }

  return updatedCount;
}
