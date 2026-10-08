import type { ScheduleSnapshot, ScheduleCell } from "./workspace-types";

export function scheduleDateRange(from: string, to: string) {
  const days: string[] = [];
  for (const date = new Date(`${from}T12:00:00Z`); date.toISOString().slice(0, 10) <= to; date.setUTCDate(date.getUTCDate() + 1)) {
    days.push(date.toISOString().slice(0, 10));
    if (days.length > 366) throw new Error("Choose a schedule range of at most one year.");
  }
  return days;
}
export function shiftDate(day: string, delta: number) {
  const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + delta); return date.toISOString().slice(0, 10);
}
export function scheduleLabel(snapshot: ScheduleSnapshot) {
  if (snapshot.kind === "unconfigured") return "Unconfigured";
  if (snapshot.kind === "rest") return "Rest day";
  return snapshot.checkInTime && snapshot.checkOutTime
    ? `${snapshot.shiftCode ?? snapshot.shiftName} · ${snapshot.checkInTime.slice(0, 5)}–${snapshot.checkOutTime.slice(0, 5)}`
    : `${snapshot.shiftName} · ${snapshot.hoursPerDay}h flexible`;
}
export function scheduleValue(snapshot: ScheduleSnapshot) {
  return snapshot.kind === "shift" ? snapshot.shiftTableId ? String(snapshot.shiftTableId) : "captured" : snapshot.kind;
}
export function emptySchedule(kind: "rest" | "unconfigured"): ScheduleSnapshot {
  return { kind, shiftTableId: null, shiftName: kind === "rest" ? "Rest day" : "Unconfigured", shiftCode: null, checkInTime: null, checkOutTime: null, breakMinutes: 0, paidBreakMinutes: 0, graceMinutes: 0, hoursPerDay: 0, isFlexible: false, breaks: [] };
}
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stableValue(entry)]));
  return value;
}
export function sameSchedule(left: ScheduleSnapshot, right: ScheduleSnapshot) { return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right)); }
export function applyScheduleChanges(cells: ScheduleCell[], changes: Array<{employeeId:string;day:string;value:string}>, templates: Map<string,ScheduleSnapshot>) {
  const result = structuredClone(cells);
  const byKey = new Map(result.map(cell => [`${cell.employeeId}:${cell.day}`, cell]));
  const seen = new Set<string>();
  for (const change of changes) {
    const key = `${change.employeeId}:${change.day}`;
    if (seen.has(key)) throw new Error("A workday was submitted more than once.");
    seen.add(key);
    const cell = byKey.get(key);
    if (!cell) throw new Error("A selected employee or workday is outside this branch and payroll period.");
    const snapshot = change.value === "default" ? cell.defaultSnapshot
      : change.value === "latest-default" ? cell.latestDefaultSnapshot ?? cell.defaultSnapshot
      : change.value === "rest" || change.value === "unconfigured" ? emptySchedule(change.value)
      : change.value === "captured" ? cell.baselineSnapshot : templates.get(change.value) ?? (change.value === cell.baselineValue ? cell.baselineSnapshot : undefined);
    if (!snapshot) throw new Error("The selected shift is no longer available.");
    cell.snapshot = structuredClone(snapshot); cell.value = scheduleValue(snapshot); cell.label = scheduleLabel(snapshot); cell.source = "Period exception";
    if (change.value === "latest-default") {
      cell.defaultSnapshot = structuredClone(snapshot); cell.defaultValue = scheduleValue(snapshot); cell.defaultLabel = scheduleLabel(snapshot);
    }
  }
  return result;
}
