export const DTR_ABSENCE_MINUTES_PER_DAY = 8 * 60;

function toNonNegativeNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

export function computeGeneratedDtrLwopMinutes(args: {
  undertimeMinutes: number | null | undefined;
  absentDays: number | null | undefined;
}) {
  const undertimeMinutes = Math.round(
    toNonNegativeNumber(args.undertimeMinutes)
  );
  const absenceMinutes = Math.round(
    toNonNegativeNumber(args.absentDays) * DTR_ABSENCE_MINUTES_PER_DAY
  );

  return undertimeMinutes + absenceMinutes;
}
