export type HolidayCheckDateRange = {
  id: number | string;
  holidayDate: string | null;
  holidayDate2?: string | null;
};

export type HolidayCheckDateAssignment = {
  id: number | string;
  checkDate1: string;
  checkDate2: string;
};

export type HolidayCheckDateBackfillRow = HolidayCheckDateRange & {
  checkDate1?: string | null;
  checkDate2?: string | null;
};

export type HolidayCheckDateBackfillUpdate = {
  id: number | string;
  checkDate1?: string;
  checkDate2?: string;
  requireCheckDate1?: true;
  requireCheckDate2?: true;
};

type HolidayBlock = {
  startDate: string;
  endDate: string;
  rows: HolidayCheckDateRange[];
};

function createUtcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return createUtcDate(year, month, day);
}

function formatDateOnly(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number) {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

function compareDateOnly(left: string, right: string) {
  return left.localeCompare(right);
}

export function buildHolidayCheckDateAssignments(
  rows: HolidayCheckDateRange[]
): HolidayCheckDateAssignment[] {
  const sortedRows = rows
    .filter((row): row is HolidayCheckDateRange & { holidayDate: string } =>
      Boolean(row.holidayDate)
    )
    .map((row) => ({
      ...row,
      holidayDate2:
        row.holidayDate2 && row.holidayDate2 >= row.holidayDate
          ? row.holidayDate2
          : row.holidayDate,
    }))
    .sort((left, right) => {
      const dateCompare = compareDateOnly(left.holidayDate, right.holidayDate);
      if (dateCompare !== 0) return dateCompare;
      return compareDateOnly(left.holidayDate2, right.holidayDate2);
    });

  const blocks: HolidayBlock[] = [];

  for (const row of sortedRows) {
    const previous = blocks[blocks.length - 1];
    if (!previous) {
      blocks.push({
        startDate: row.holidayDate,
        endDate: row.holidayDate2,
        rows: [row],
      });
      continue;
    }

    const nextOpenDate = addDays(previous.endDate, 1);
    if (row.holidayDate <= nextOpenDate) {
      previous.endDate =
        row.holidayDate2 > previous.endDate ? row.holidayDate2 : previous.endDate;
      previous.rows.push(row);
      continue;
    }

    blocks.push({
      startDate: row.holidayDate,
      endDate: row.holidayDate2,
      rows: [row],
    });
  }

  return blocks.flatMap((block) => {
    const checkDate1 = addDays(block.startDate, -1);
    const checkDate2 = addDays(block.endDate, 1);

    return block.rows.map((row) => ({
      id: row.id,
      checkDate1,
      checkDate2,
    }));
  });
}

export function buildHolidayCheckDateBackfillUpdates(
  rows: HolidayCheckDateBackfillRow[]
): HolidayCheckDateBackfillUpdate[] {
  const assignmentById = new Map(
    buildHolidayCheckDateAssignments(rows).map((assignment) => [
      assignment.id,
      assignment,
    ])
  );

  return rows.flatMap((row) => {
    const assignment = assignmentById.get(row.id);
    if (!assignment) return [];

    const update: HolidayCheckDateBackfillUpdate = { id: row.id };
    if (!row.checkDate1) {
      update.checkDate1 = assignment.checkDate1;
      update.requireCheckDate1 = true;
    }
    if (!row.checkDate2) {
      update.checkDate2 = assignment.checkDate2;
      update.requireCheckDate2 = true;
    }

    return Object.keys(update).length > 1 ? [update] : [];
  });
}
