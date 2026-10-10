import type { ResolvedEmployeeSchedule } from "@/lib/payroll/scheduleResolver";
import { calculationPolicyFor, punchPolicyFor } from "@/lib/shifts";
import { emptySchedule } from "./model";
import { describeSchedule } from "./presentation";
import type { ScheduleSnapshot } from "./workspace-types";

/** Calendar labels use frozen values when available and the exact historical
 * template ID otherwise. Active catalog filtering must never rewrite history. */
export function describeResolvedSchedule(resolved: ResolvedEmployeeSchedule, breaks: Map<number, ScheduleSnapshot["breaks"]>) {
  const assignment = resolved.overrideAssignment, weekly = resolved.weeklyPatternDay;
  const saved = assignment?.confirmedSchedule ?? weekly?.definitionSnapshot;
  if (saved) return describeSchedule(saved);
  if (!resolved.configured) return describeSchedule(emptySchedule("unconfigured"));
  if (resolved.shiftWindow.restDay === resolved.dayName) return describeSchedule(emptySchedule("rest"));
  const row = assignment ?? weekly, window = resolved.shiftWindow;
  return describeSchedule({
    kind: "shift", shiftTableId: row?.shiftTableId ?? null, shiftName: row?.shiftName ?? "", shiftCode: row?.shiftCode ?? null,
    checkInTime: window.checkInTime ?? null, checkOutTime: window.checkOutTime ?? null,
    breakMinutes: window.breakMinutes ?? 0, paidBreakMinutes: row?.paidBreakMinutes ?? 0, graceMinutes: window.graceMinutes ?? 0,
    hoursPerDay: resolved.hoursPerDay, isFlexible: !window.checkInTime || !window.checkOutTime,
    calculationPolicy: calculationPolicyFor(row?.calculationPolicy), punchPolicy: punchPolicyFor(row?.punchPolicy),
    breaks: breaks.get(row?.shiftTableId ?? 0) ?? [],
  });
}
