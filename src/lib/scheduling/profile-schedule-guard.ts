/** Undated employee fields are historical fallback data, not a schedule editor. */
const profileScheduleFields = [
  "shiftSchedule",
  "checkInTime",
  "checkOutTime",
  "restDay",
  "hoursWorked",
  "minutesWorked",
] as const;

type ProfileScheduleField = (typeof profileScheduleFields)[number];
type ProfileScheduleValues = Partial<Record<ProfileScheduleField, unknown>>;

export class ProfileScheduleChangeError extends Error {
  constructor() {
    super("Employee profile schedule settings cannot be created or changed here. Use Schedules (/schedules) to review and apply shifts for the intended dates. Existing saved profile settings are preserved.");
    this.name = "ProfileScheduleChangeError";
  }
}

function comparisonValue(field: ProfileScheduleField, value: unknown) {
  const text = value == null ? "" : String(value).trim();
  if (field === "hoursWorked" || field === "minutesWorked") {
    const number = text === "" ? 0 : Number(text);
    return Number.isFinite(number) ? number : text;
  }
  if (field === "checkInTime" || field === "checkOutTime") {
    if (!text) return null;
    const time = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(text);
    if (time && Number(time[1]) < 24 && Number(time[2]) < 60 && Number(time[3] ?? 0) < 60) {
      return Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3] ?? 0);
    }
  }
  return text || null;
}

/** Compare a partial write with the stored row after taking the shared payroll lock. */
export function assertProfileScheduleUnchanged(
  current: ProfileScheduleValues | null | undefined,
  incoming: ProfileScheduleValues,
) {
  for (const field of profileScheduleFields) {
    // Omitted CSV columns and optional fields do not overwrite saved values.
    if (incoming[field] === undefined) continue;
    if (comparisonValue(field, incoming[field]) !== comparisonValue(field, current?.[field])) {
      throw new ProfileScheduleChangeError();
    }
  }
}
