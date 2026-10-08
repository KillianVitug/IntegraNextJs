const workdayFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric",
});

/** A payroll workday is a civil date, independent of the viewer's timezone. */
export function formatWorkday(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return day;
  return workdayFormatter.format(date);
}
