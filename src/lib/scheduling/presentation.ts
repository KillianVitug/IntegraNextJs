import { SHIFT_BREAK_SLOT_DEFINITIONS, type ShiftTableReadModel } from "@/lib/shifts";
import type { ScheduleSnapshot } from "./workspace-types";

export type SchedulePresentation = {
  label: string;
  periodsLabel: string;
  details: string[];
  warnings: string[];
};

type TimelineRange = { start: number; end: number };
type DisplayBreak = ScheduleSnapshot["breaks"][number];
type DescribedSchedule = { presentation: SchedulePresentation; sortKey: number[] };

// Use a civil-time timeline, without host timezone or Date parsing. Preserve
// nonzero stored seconds instead of silently presenting a different boundary.
function clockMinutes(value: string | null | undefined): number | null {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return null;
  const [hours, minutes, seconds = 0] = value.split(":").map(Number);
  return hours * 60 + minutes + seconds / 60;
}

function numberLabel(value: number) { return String(Math.round(value * 100) / 100); }
function timeLabel(value: number) {
  const seconds = Math.round(value * 60);
  const day = Math.floor(seconds / 86400);
  const clock = seconds % 86400;
  const hours = String(Math.floor(clock / 3600)).padStart(2, "0");
  const minutes = String(Math.floor(clock % 3600 / 60)).padStart(2, "0");
  const remainder = clock % 60;
  return `${hours}:${minutes}${remainder ? `:${String(remainder).padStart(2, "0")}` : ""}${day ? ` (+${day} day${day === 1 ? "" : "s"})` : ""}`;
}
function rangeLabel(range: TimelineRange) { return `${timeLabel(range.start)}–${timeLabel(range.end)}`; }
function regularRange(item: DisplayBreak, shift: TimelineRange | null): TimelineRange | null {
  const from = clockMinutes(item.fromTime), to = clockMinutes(item.toTime);
  if (from === null || to === null) return null;
  const start = from + (shift && shift.end >= 1440 && from < shift.start ? 1440 : 0);
  let end = to + (shift && shift.end >= 1440 && to < shift.start ? 1440 : 0);
  if (end <= start) end += 1440;
  return { start, end };
}
function deduction(item: DisplayBreak) {
  const value = item.deduct ? item.deductHours * 60 + item.deductMinutes : 0;
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function describeBreak(item: DisplayBreak, range: TimelineRange | null) {
  const time = range ? rangeLabel(range) : `${item.fromTime || "?"}–${item.toTime || "?"}`;
  const unpaid = deduction(item), duration = range ? range.end - range.start : null;
  if (unpaid === null || duration === null || unpaid > duration) return `${time} (deduction needs review)`;
  const paid = duration - unpaid;
  const pay = unpaid ? `${numberLabel(unpaid)} min unpaid${paid ? ` / ${numberLabel(paid)} min paid` : ""}` : `${numberLabel(paid)} min paid`;
  return `${time} (${pay}${item.requiresPunches ? "; OUT/IN required" : ""})`;
}
function finish(periodsLabel: string, details: string[], warnings: string[], sortKey: number[]): DescribedSchedule {
  const uniqueWarnings = [...new Set(warnings)];
  return { presentation: { label: [periodsLabel, ...details, ...uniqueWarnings].join(" · "), periodsLabel, details, warnings: uniqueWarnings }, sortKey };
}

function describe(snapshot: ScheduleSnapshot): DescribedSchedule {
  if (snapshot.kind !== "shift") return finish(snapshot.kind === "rest" ? "Rest day" : "Unconfigured", [], [], [snapshot.kind === "rest" ? 3 : 4]);
  const start = clockMinutes(snapshot.checkInTime), endClock = clockMinutes(snapshot.checkOutTime);
  const shift = start !== null && endClock !== null ? { start, end: endClock <= start ? endClock + 1440 : endClock } : null;
  const details: string[] = [], warnings: string[] = [];
  const regular: Array<{ item: DisplayBreak; range: TimelineRange | null }> = [];
  const overtime: Array<{ item: DisplayBreak; range: TimelineRange | null }> = [];
  let regularValid = true;
  for (const item of snapshot.breaks as DisplayBreak[]) {
    const definition = SHIFT_BREAK_SLOT_DEFINITIONS.find(slot => slot.slotKey === item.slotKey);
    const range = regularRange(item, shift);
    if (!definition) { warnings.push("Unrecognized break type; review saved settings"); regularValid = false; continue; }
    const unpaid = deduction(item);
    if (!range || unpaid === null || unpaid > range.end - range.start) {
      warnings.push(`${definition.category === "ot" ? "OT break" : "Break"} settings need review`);
      if (definition.category === "regular") regularValid = false;
    }
    if (definition.category === "regular") {
      if (range && shift && (range.start < shift.start || range.end > shift.end)) { warnings.push("Break falls outside scheduled times"); regularValid = false; }
      regular.push({ item, range });
    } else overtime.push({ item, range });
  }
  const byTime = (left: typeof regular[number], right: typeof regular[number]) => (left.range?.start ?? Infinity) - (right.range?.start ?? Infinity) || left.item.sortOrder - right.item.sortOrder;
  regular.sort(byTime); overtime.sort(byTime);
  for (let index = 1; index < regular.length; index++) {
    const previous = regular[index - 1].range, current = regular[index].range;
    if (previous && current && current.start < previous.end) { warnings.push("Break windows overlap"); regularValid = false; }
  }
  const totalUnpaid = regular.reduce((sum, { item }) => sum + (deduction(item) ?? 0), 0);
  const totalPaid = regular.reduce((sum, { item, range }) => sum + Math.max(0, (range ? range.end - range.start : 0) - (deduction(item) ?? 0)), 0);
  const sameMinutes = (left: number, right: number) => Number.isFinite(left) && Math.abs(left - right) < 0.01;
  if (!sameMinutes(snapshot.breakMinutes, totalUnpaid) || !sameMinutes(snapshot.paidBreakMinutes, totalPaid)) {
    warnings.push(regular.length ? "Saved break totals differ from break windows" : "Break times not configured");
    regularValid = false;
  }
  if (Number.isFinite(snapshot.hoursPerDay) && snapshot.hoursPerDay >= 0) {
    details.push(`${numberLabel(snapshot.hoursPerDay)}h scheduled`);
    if (snapshot.calculationPolicy === "eight_hour_day") {
      details.push(`${numberLabel(Math.min(8, snapshot.hoursPerDay))}h normal${snapshot.hoursPerDay > 8 ? ` + ${numberLabel(snapshot.hoursPerDay - 8)}h OT` : ""}`);
    }
  } else warnings.push("Scheduled hours need review");
  if (snapshot.isFlexible) details.push("Flexible");
  if (snapshot.graceMinutes > 0) details.push(`${numberLabel(snapshot.graceMinutes)} min grace`);
  if (regular.length) details.push(`Breaks ${regular.map(({ item, range }) => describeBreak(item, range)).join("; ")}`);
  else if (snapshot.breakMinutes || snapshot.paidBreakMinutes) details.push(`${numberLabel(snapshot.breakMinutes)} min unpaid / ${numberLabel(snapshot.paidBreakMinutes)} min paid break`);
  if (overtime.length) details.push(`OT breaks ${overtime.map(({ item, range }) => describeBreak(item, range)).join("; ")}`);
  if (snapshot.punchPolicy === "split_gaps") {
    const marked = regular.filter(({ item }) => item.requiresPunches);
    const validMarked = regularValid && shift && marked.every(({ range }) => range && range.start > shift.start && range.end < shift.end)
      && marked.every(({ range }, index) => !index || range!.start > marked[index - 1].range!.end);
    if (validMarked) details.push(`${(marked.length + 1) * 2} punches required`);
    else warnings.push("Punch requirements need review");
  } else if (snapshot.punchPolicy === "outer") details.push("2 punches required");
  else details.push(`${[snapshot.shiftCode, snapshot.shiftName].some(value => value?.toUpperCase().includes("SPLIT")) ? 4 : 2} punches minimum`);

  if (!shift) {
    const incomplete = Boolean(snapshot.checkInTime || snapshot.checkOutTime);
    warnings.push(incomplete ? "Start/end times need review" : "Start/end times not configured");
    return finish(snapshot.isFlexible ? "Flexible schedule" : "Schedule times unavailable", details, warnings, [snapshot.isFlexible ? 1 : 2]);
  }
  const periods: TimelineRange[] = [];
  if (regularValid) {
    let cursor = shift.start;
    for (const { range } of regular) {
      if (!range) continue;
      if (range.start > cursor) periods.push({ start: cursor, end: range.start });
      cursor = range.end;
    }
    if (cursor < shift.end) periods.push({ start: cursor, end: shift.end });
    if (!periods.length) warnings.push("No work period remains after breaks");
  }
  const displayed = regularValid && periods.length ? periods : [shift];
  const periodsLabel = displayed.map(rangeLabel).join(" / ");
  return finish(periodsLabel, details, warnings, [0, ...displayed.flatMap(period => [period.start, period.end])]);
}

/** Labels are derived from the supplied captured values; no current template lookup. */
export function describeSchedule(snapshot: ScheduleSnapshot): SchedulePresentation { return describe(snapshot).presentation; }

/** Keep native pickers scannable; full policy/break details remain in the review. */
export function scheduleChoiceLabels(shifts: readonly { id: number; snapshot: ScheduleSnapshot }[]) {
  const choices = shifts.map(shift => ({ id: shift.id, ...describeSchedule(shift.snapshot) }));
  const labels = new Map<number, string>();
  for (const choice of choices) {
    const peers = choices.filter(other => other.periodsLabel === choice.periodsLabel);
    const differences = peers.length > 1
      ? choice.details.filter(detail => peers.some(other => !other.details.includes(detail)))
      : [];
    labels.set(choice.id, [choice.periodsLabel,
      ...differences,
      ...(choice.warnings.length ? ["Check settings"] : []),
    ].join(" · "));
  }
  return new Map([...labels].map(([id, label]) => {
    const identical = [...labels].filter(([, other]) => other === label);
    return [id, identical.length > 1 ? `${label} · Option ${identical.findIndex(([otherId]) => otherId === id) + 1}` : label];
  }));
}

/** Numeric timeline first, policy details second. Callers must retain distinct IDs. */
export function compareScheduleSnapshots(left: ScheduleSnapshot, right: ScheduleSnapshot) {
  const a = describe(left), b = describe(right);
  for (let index = 0; index < Math.max(a.sortKey.length, b.sortKey.length); index++) {
    const difference = (a.sortKey[index] ?? -1) - (b.sortKey[index] ?? -1);
    if (difference) return difference;
  }
  return a.presentation.label.localeCompare(b.presentation.label, "en", { numeric: true }) || (left.shiftTableId ?? 0) - (right.shiftTableId ?? 0);
}

/** The lookup read model includes empty optional slots; only populated ones are saved breaks. */
export function shiftTableScheduleSnapshot(table: ShiftTableReadModel): ScheduleSnapshot {
  return {
    kind: "shift", shiftTableId: table.id, shiftCode: table.code, shiftName: table.description,
    checkInTime: table.regularStartTime || null, checkOutTime: table.regularEndTime || null,
    hoursPerDay: table.hoursPerDay, breakMinutes: table.deductibleBreakMinutes, paidBreakMinutes: table.paidBreakMinutes,
    graceMinutes: 0, isFlexible: false,
    ...(table.calculationPolicy ? { calculationPolicy: table.calculationPolicy } : {}),
    ...(table.punchPolicy ? { punchPolicy: table.punchPolicy } : {}),
    breaks: table.breaks.filter(row => row.fromTime || row.toTime || row.deduct || row.deductHours || row.deductMinutes).map(row => ({ ...row, fromTime: row.fromTime ?? "", toTime: row.toTime ?? "" })),
  };
}
export function shiftTableScheduleLabel(table: ShiftTableReadModel) { return describeSchedule(shiftTableScheduleSnapshot(table)).label; }
export function compareShiftTableSchedules(left: ShiftTableReadModel, right: ShiftTableReadModel) { return compareScheduleSnapshots(shiftTableScheduleSnapshot(left), shiftTableScheduleSnapshot(right)) || left.id - right.id; }
