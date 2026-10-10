import { eq, inArray } from "drizzle-orm";
import type { DbClient } from "@/db";
import { employeeShiftAssignments, employeeWeeklyShiftPatterns, employeesTimekeeping, shiftTableBreaks } from "@/db/schema";
import { resolveEmployeeScheduleForDate } from "@/lib/payroll/scheduleResolver";
import { calculationPolicyFor, punchPolicyFor } from "@/lib/shifts";
import { PayrollValidationError } from "@/lib/payroll/validation";
import { convertUnifiedRuleSnapshot, UNIFIED_RULE_EFFECTIVE_FROM } from "./unified-rule-conversion";
import type { ScheduleSnapshot } from "./workspace-types";

export type OperationalScheduleRange = { startDate: string; endDate: string | null };
type EffectiveRange = { effectiveFrom: string; effectiveTo: string | null };
const direction = "Use Schedules (/schedules) to choose or review a current schedule; no changes were saved.";

/** History remains readable. Every newly effective working definition from the
 * adopted date must carry reviewed calculation and punch metadata. */
export function assertOperationalSchedule(snapshot: ScheduleSnapshot, range: OperationalScheduleRange) {
  if (range.endDate && range.endDate < UNIFIED_RULE_EFFECTIVE_FROM || snapshot.kind !== "shift") return;
  if (snapshot.calculationPolicy !== "eight_hour_day" || !["outer", "split_gaps"].includes(snapshot.punchPolicy ?? "")) {
    throw new PayrollValidationError(`Working schedules from ${UNIFIED_RULE_EFFECTIVE_FROM} require the current eight-hour rule and reviewed punches. ${direction}`);
  }
  const active = snapshot.breaks.filter(row => row.fromTime || row.toTime || row.deduct || row.requiresPunches || row.deductHours || row.deductMinutes);
  const slots = active.filter(row => row.requiresPunches).map(row => row.slotKey);
  if ((snapshot.punchPolicy === "split_gaps") !== (slots.length > 0)) throw new PayrollValidationError(`Review the split-gap punch settings. ${direction}`);
  try { convertUnifiedRuleSnapshot({ ...snapshot, breaks: active }, { reviewedSplitGapSlots: slots }); }
  catch (error) { throw new PayrollValidationError(`${error instanceof Error ? error.message : "The schedule definition needs review."} ${direction}`); }
}

/** Every source changes only at an effective-date boundary, and repeats weekly
 * within it. Sample all seven weekdays per segment, including open-ended tails. */
export function operationalScheduleSampleDates(range: OperationalScheduleRange, records: EffectiveRange[]) {
  const first = range.startDate < UNIFIED_RULE_EFFECTIVE_FROM ? UNIFIED_RULE_EFFECTIVE_FROM : range.startDate;
  const last = range.endDate ?? "9999-12-31";
  if (first > last) return [];
  const next = (day: string, amount: number) => new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
  const boundaries = new Set([first]);
  for (const row of records) {
    if (row.effectiveFrom > first && row.effectiveFrom <= last) boundaries.add(row.effectiveFrom);
    if (row.effectiveTo && row.effectiveTo >= first && row.effectiveTo < last) boundaries.add(next(row.effectiveTo, 1));
  }
  const starts = [...boundaries].sort(), result: string[] = [];
  for (const [index, start] of starts.entries()) for (let offset = 0; offset < 7; offset++) {
    if (Date.parse(`${start}T12:00:00Z`) + offset * 86400000 > Date.parse(`${last}T12:00:00Z`)) break;
    const day = next(start, offset);
    if (day > last || starts[index + 1] && day >= starts[index + 1]) break;
    result.push(day);
  }
  return result;
}

/** Call within the mutation transaction after the common payroll-input lock.
 * Validate only coverage actually removed; new coverage is checked separately. */
export async function assertOperationalAssignmentSuccessor(tx: DbClient, args: { employeeId: string; range: OperationalScheduleRange; excludedRanges?: EffectiveRange[] }) {
  if (args.range.endDate && args.range.endDate < UNIFIED_RULE_EFFECTIVE_FROM) return;
  const [assignments, patterns, timekeeping] = await Promise.all([
    tx.select().from(employeeShiftAssignments).where(eq(employeeShiftAssignments.employeeId, args.employeeId)),
    tx.query.employeeWeeklyShiftPatterns.findMany({ where: eq(employeeWeeklyShiftPatterns.employeeId, args.employeeId), with: { days: true } }),
    tx.query.employeesTimekeeping.findFirst({ where: eq(employeesTimekeeping.employeeId, args.employeeId) }),
  ]);
  const ids = [...new Set([...assignments.map(row => row.shiftTableId), ...patterns.flatMap(row => row.days.map(day => day.shiftTableId))].filter((id): id is number => id != null))];
  const breaks = ids.length ? await tx.select().from(shiftTableBreaks).where(inArray(shiftTableBreaks.shiftTableId, ids)) : [];
  for (const day of operationalScheduleSampleDates(args.range, [...assignments, ...patterns, ...(args.excludedRanges ?? [])])) {
    if (args.excludedRanges?.some(range => range.effectiveFrom <= day && (!range.effectiveTo || range.effectiveTo >= day))) continue;
    const resolved = resolveEmployeeScheduleForDate({ attendanceDate: day, assignments, weeklyPatterns: patterns, legacyTimekeeping: timekeeping ?? null });
    if (!resolved.configured || resolved.shiftWindow.restDay === resolved.dayName) continue;
    const record = resolved.overrideAssignment ?? resolved.weeklyPatternDay;
    const frozen = resolved.overrideAssignment?.confirmedSchedule ?? resolved.weeklyPatternDay?.definitionSnapshot;
    const snapshot: ScheduleSnapshot = frozen ?? { kind: "shift", shiftTableId: record?.shiftTableId ?? null, shiftName: record?.shiftName ?? "Employee default", shiftCode: record?.shiftCode ?? null,
      checkInTime: resolved.shiftWindow.checkInTime ?? null, checkOutTime: resolved.shiftWindow.checkOutTime ?? null, breakMinutes: resolved.shiftWindow.breakMinutes ?? 0,
      paidBreakMinutes: record?.paidBreakMinutes ?? 0, graceMinutes: resolved.shiftWindow.graceMinutes ?? 0, hoursPerDay: resolved.hoursPerDay,
      isFlexible: !resolved.shiftWindow.checkInTime || !resolved.shiftWindow.checkOutTime,
      calculationPolicy: calculationPolicyFor(record?.calculationPolicy), punchPolicy: punchPolicyFor(record?.punchPolicy),
      breaks: breaks.filter(row => row.shiftTableId === record?.shiftTableId) };
    assertOperationalSchedule(snapshot, { startDate: day, endDate: day });
  }
}
