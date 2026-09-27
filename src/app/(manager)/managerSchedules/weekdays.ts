export const WEEKLY_BASE_SCHEDULE_WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type WeeklyBaseScheduleWeekday =
  (typeof WEEKLY_BASE_SCHEDULE_WEEKDAYS)[number];
