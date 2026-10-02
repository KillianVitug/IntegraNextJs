export type AttendanceSourcePeriod = {
  id: string;
  code: string;
  year: number;
  startDate: string;
  endDate: string;
};

export function selectAttendanceSourcePeriod(
  periods: AttendanceSourcePeriod[],
  requested: { year?: string; periodId?: string },
  today: string,
) {
  const explicit = periods.find(period => period.id === requested.periodId);
  const requestedYear = Number(requested.year);
  const year = explicit?.year ?? (
    Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100
      ? requestedYear : Number(today.slice(0, 4))
  );
  const choices = periods.filter(period => period.year === year)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.code.localeCompare(b.code));
  const current = choices.find(period => period.startDate <= today && period.endDate >= today);
  const past = choices.filter(period => period.endDate < today)
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  return { year, periods: choices, periodId: explicit?.id ?? current?.id ?? past?.id ?? choices[0]?.id ?? "" };
}

export function attendancePeriodUrl(path: string, year: number, periodId: string) {
  const query = new URLSearchParams({ year: String(year) });
  if (periodId) query.set("periodId", periodId);
  return `${path}?${query}`;
}
