import { SHIFT_BREAK_SLOT_DEFINITIONS, deriveShiftMetricsFromTable, type ShiftBreakSlotKey } from "@/lib/shifts";
import { describeSchedule } from "./presentation";
import type { ScheduleSnapshot } from "./workspace-types";

export const UNIFIED_RULE_EFFECTIVE_FROM = "2026-10-01";

export type UnifiedRuleConversionReview = {
  /** Explicit reviewed slots, including [] for an ordinary schedule. Never infer from names/order. */
  reviewedSplitGapSlots?: readonly ShiftBreakSlotKey[];
};

function clock(value: string | null, description: string) {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value)) {
    throw new Error(`${description} needs a complete whole-minute time; original settings were retained.`);
  }
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Validates the existing timeline; conversion changes only calculation/punch metadata. */
export function convertUnifiedRuleSnapshot(snapshot: ScheduleSnapshot, review: UnifiedRuleConversionReview = {}): ScheduleSnapshot {
  const result = structuredClone(snapshot);
  if (snapshot.kind !== "shift") return result;
  const slots = review.reviewedSplitGapSlots;
  if (!Array.isArray(slots)) throw new Error("Review and supply the split-gap slot mapping, or an explicit empty mapping for an ordinary schedule.");
  if (new Set(slots).size !== slots.length) throw new Error("The reviewed split-gap mapping contains duplicate slots.");
  const origin = clock(snapshot.checkInTime, "Schedule start"), finishClock = clock(snapshot.checkOutTime, "Schedule end");
  if (origin === finishClock) throw new Error("A working schedule must be shorter than 24 hours.");
  const finish = finishClock < origin ? finishClock + 1440 : finishClock;
  if (!Number.isFinite(snapshot.graceMinutes) || snapshot.graceMinutes < 0 || !Number.isInteger(snapshot.graceMinutes)) throw new Error("Grace minutes need review.");
  const seen = new Set<ShiftBreakSlotKey>();
  const windows = snapshot.breaks.map(row => {
    const definition = SHIFT_BREAK_SLOT_DEFINITIONS.find(slot => slot.slotKey === row.slotKey);
    if (!definition || seen.has(row.slotKey)) throw new Error("Unknown or duplicate saved break slot; review the original definition.");
    seen.add(row.slotKey);
    const fromClock = clock(row.fromTime, `${row.slotKey} start`), toClock = clock(row.toTime, `${row.slotKey} end`);
    if (fromClock === toClock) throw new Error("A break needs different start and end times.");
    const from = fromClock < origin ? fromClock + 1440 : fromClock;
    let to = toClock < origin ? toClock + 1440 : toClock;
    if (to <= from) to += 1440;
    if (![row.deductHours, row.deductMinutes].every(value => Number.isInteger(value) && value >= 0) || row.deductHours > 23 || row.deductMinutes > 59) throw new Error("Break deduction quantities need review.");
    const amount = row.deductHours * 60 + row.deductMinutes;
    if ((!row.deduct && amount !== 0) || (row.deduct && amount <= 0) || amount > to - from) throw new Error("Break payment does not match its saved window.");
    if (definition.category === "regular" && (from < origin || to > finish)) throw new Error("A regular break falls outside the scheduled working window.");
    if (slots.includes(row.slotKey) && (definition.category !== "regular" || from <= origin || to >= finish)) throw new Error("Each reviewed split gap needs work before and after it and must be a regular break.");
    return { from, to, slotKey: row.slotKey };
  }).sort((left, right) => left.from - right.from);
  for (const slot of slots) if (!seen.has(slot)) throw new Error(`The reviewed split gap ${slot} has no complete saved break window.`);
  for (let index = 1; index < windows.length; index++) if (windows[index].from < windows[index - 1].to) throw new Error("Break windows overlap; review the saved definition before conversion.");
  const gaps = windows.filter(row => slots.includes(row.slotKey));
  for (let index = 1; index < gaps.length; index++) if (gaps[index].from <= gaps[index - 1].to) throw new Error("Split gaps must have a working period between them.");
  const metrics = deriveShiftMetricsFromTable({ code: snapshot.shiftCode ?? "", description: snapshot.shiftName, regularStartTime: snapshot.checkInTime!, regularEndTime: snapshot.checkOutTime!, breaks: snapshot.breaks });
  if (metrics.hoursPerDay <= 0 || !Number.isFinite(snapshot.hoursPerDay) || Math.abs(metrics.hoursPerDay - snapshot.hoursPerDay) > 0.005) throw new Error("Saved scheduled hours differ from the complete working and break windows.");
  result.calculationPolicy = "eight_hour_day";
  result.punchPolicy = slots.length ? "split_gaps" : "outer";
  result.breaks = result.breaks.map(row => ({ ...row, requiresPunches: slots.includes(row.slotKey) }));
  const warnings = describeSchedule(result).warnings;
  if (warnings.length) throw new Error(`Review saved schedule settings before conversion: ${warnings.join("; ")}`);
  return result;
}

export type UnifiedRuleRange = { effectiveFrom: string; effectiveTo: string | null };
export type UnifiedRuleProtection = { startDate: string; endDate: string | null; status: "Closed" | "Approved" | "Posted"; reference?: string };
export type UnifiedRuleRangePartition = {
  historical: UnifiedRuleRange | null;
  eligible: UnifiedRuleRange[];
  blocked: Array<UnifiedRuleRange & { protections: UnifiedRuleProtection[] }>;
};

function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01" || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("Use a valid calendar date in YYYY-MM-DD format.");
  return value;
}
function offset(value: string, days: number) { return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }

/** Inclusive intervals. Caller supplies protection for this employee, including overnight neighbors. */
export function partitionUnifiedRuleRange(range: UnifiedRuleRange, protections: readonly UnifiedRuleProtection[] = []): UnifiedRuleRangePartition {
  date(range.effectiveFrom);
  if (range.effectiveTo !== null && date(range.effectiveTo) < range.effectiveFrom) throw new Error("Range end must not precede its start.");
  for (const protection of protections) {
    date(protection.startDate);
    if (protection.endDate !== null && date(protection.endDate) < protection.startDate) throw new Error("Protection end must not precede its start.");
    if (!["Closed", "Approved", "Posted"].includes(protection.status)) throw new Error("Protection must identify a Closed period or Approved/Posted payroll.");
  }
  const result: UnifiedRuleRangePartition = { historical: null, eligible: [], blocked: [] };
  if (range.effectiveFrom < UNIFIED_RULE_EFFECTIVE_FROM) result.historical = { effectiveFrom: range.effectiveFrom, effectiveTo: range.effectiveTo && range.effectiveTo < UNIFIED_RULE_EFFECTIVE_FROM ? range.effectiveTo : offset(UNIFIED_RULE_EFFECTIVE_FROM, -1) };
  if (range.effectiveTo && range.effectiveTo < UNIFIED_RULE_EFFECTIVE_FROM) return result;
  const start = range.effectiveFrom > UNIFIED_RULE_EFFECTIVE_FROM ? range.effectiveFrom : UNIFIED_RULE_EFFECTIVE_FROM;
  const boundary = new Set([start]);
  for (const protection of protections) {
    if (protection.startDate > start && (!range.effectiveTo || protection.startDate <= range.effectiveTo)) boundary.add(protection.startDate);
    if (protection.endDate && protection.endDate >= start && protection.endDate < "9999-12-31" && (!range.effectiveTo || protection.endDate < range.effectiveTo)) boundary.add(offset(protection.endDate, 1));
  }
  const starts = [...boundary].sort();
  for (const [index, effectiveFrom] of starts.entries()) {
    const segment = { effectiveFrom, effectiveTo: starts[index + 1] ? offset(starts[index + 1], -1) : range.effectiveTo };
    const blocked = protections.filter(item => item.startDate <= effectiveFrom && (!item.endDate || item.endDate >= effectiveFrom));
    if (blocked.length) result.blocked.push({ ...segment, protections: structuredClone(blocked) });
    else result.eligible.push(segment);
  }
  return result;
}
