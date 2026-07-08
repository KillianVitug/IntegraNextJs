export function roundDtrLateMinutes(minutes: number | null | undefined) {
  const normalizedMinutes = Math.max(0, Math.round(minutes ?? 0));
  if (normalizedMinutes <= 0) return 0;

  return Math.ceil(normalizedMinutes / 60) * 60;
}

export function roundDtrUndertimeMinutes(minutes: number | null | undefined) {
  const normalizedMinutes = Math.max(0, Math.round(minutes ?? 0));
  if (normalizedMinutes <= 0) return 0;

  return Math.ceil(normalizedMinutes / 30) * 30;
}

export function splitDtrLateArrivalMinutes(minutes: number | null | undefined) {
  const normalizedMinutes = Math.max(0, Math.round(minutes ?? 0));
  if (normalizedMinutes <= 0) {
    return {
      lateMinutes: 0,
      undertimeMinutes: 0,
    };
  }

  return {
    lateMinutes: 60,
    undertimeMinutes: roundDtrUndertimeMinutes(
      Math.max(0, normalizedMinutes - 30)
    ),
  };
}

export function roundDtrOvertimeMinutes(minutes: number | null | undefined) {
  const normalizedMinutes = Math.max(0, Math.round(minutes ?? 0));
  if (normalizedMinutes < 60) return 0;

  return Math.floor(normalizedMinutes / 30) * 30;
}
