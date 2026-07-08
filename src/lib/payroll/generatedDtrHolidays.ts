import { computeNetDtrWorkedMinutes } from "./dtrOverrides";

export type GeneratedDtrHolidayMinutesRow = {
  scheduledMinutes: number;
  workedMinutes: number;
  regularMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
  isRestDay: boolean;
};

export type GeneratedDtrHolidayCheckDateRequirement = {
  checkDate1?: string | null;
  checkDate2?: string | null;
  requireCheckDate1?: boolean | null;
  requireCheckDate2?: boolean | null;
};

export type GeneratedDtrHolidayCheckDateAttendance = {
  attendanceDate: string;
  workedMinutes: number;
  regularMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
};

export const GENERATED_DTR_HOLIDAY_CHECK_MINUTES = 8 * 60;

function roundDays(value: number) {
  return Math.round(value * 100) / 100;
}

export function getGeneratedDtrHolidayBaseMinutes(
  row: Pick<GeneratedDtrHolidayMinutesRow, "scheduledMinutes">
) {
  return row.scheduledMinutes > 0 ? row.scheduledMinutes : 480;
}

export function getGeneratedDtrHolidayWorkedMinutes(
  row: Omit<GeneratedDtrHolidayMinutesRow, "overtimeMinutes">
) {
  if (row.isRestDay) {
    return Math.min(
      Math.max(0, Math.round(row.workedMinutes)),
      getGeneratedDtrHolidayBaseMinutes(row)
    );
  }

  if (row.workedMinutes <= 0 && row.regularMinutes <= 0) return 0;

  const scheduledMinutes = getGeneratedDtrHolidayBaseMinutes(row);
  const presentDays = Math.max(
    1,
    roundDays(row.regularMinutes / scheduledMinutes)
  );

  return computeNetDtrWorkedMinutes({
    presentDays,
    lateMinutes: row.lateMinutes,
    undertimeMinutes: row.undertimeMinutes,
  });
}

export function getGeneratedDtrHolidayOvertimeCapacityMinutes(
  row: GeneratedDtrHolidayMinutesRow
) {
  const dailyOvertimeMinutes = Math.max(0, Math.round(row.overtimeMinutes));
  if (dailyOvertimeMinutes > 0) return dailyOvertimeMinutes;

  if (!row.isRestDay) {
    return getGeneratedDtrHolidayWorkedMinutes(row);
  }

  return Math.max(
    0,
    Math.round(row.workedMinutes) - getGeneratedDtrHolidayBaseMinutes(row)
  );
}

export function getGeneratedDtrHolidayCheckNetWorkedMinutes(
  row: GeneratedDtrHolidayCheckDateAttendance
) {
  if (row.workedMinutes > 0) {
    return Math.max(
      0,
      Math.round(row.workedMinutes) -
        Math.max(0, Math.round(row.lateMinutes)) -
        Math.max(0, Math.round(row.undertimeMinutes))
    );
  }

  return Math.max(
    0,
    Math.round(row.regularMinutes) -
      Math.max(0, Math.round(row.lateMinutes)) -
      Math.max(0, Math.round(row.undertimeMinutes))
  );
}

export function isGeneratedDtrHolidayCheckRequirementSatisfied(args: {
  requirement: GeneratedDtrHolidayCheckDateRequirement | null | undefined;
  attendanceByDate: Map<string, GeneratedDtrHolidayCheckDateAttendance>;
  requiredMinutes?: number;
}) {
  const requirement = args.requirement;
  if (!requirement) return true;
  if (requirement.requireCheckDate1 && !requirement.checkDate1) return false;
  if (requirement.requireCheckDate2 && !requirement.checkDate2) return false;

  const requiredDates = [
    requirement.requireCheckDate1 ? requirement.checkDate1 : null,
    requirement.requireCheckDate2 ? requirement.checkDate2 : null,
  ].filter((date): date is string => Boolean(date));
  if (requiredDates.length === 0) return true;

  const requiredMinutes =
    args.requiredMinutes ?? GENERATED_DTR_HOLIDAY_CHECK_MINUTES;

  return requiredDates.every((date) => {
    const attendance = args.attendanceByDate.get(date);
    if (!attendance) return false;

    return getGeneratedDtrHolidayCheckNetWorkedMinutes(attendance) >= requiredMinutes;
  });
}
