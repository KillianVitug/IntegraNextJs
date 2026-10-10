import type { ProvisionalLine, ProvisionalLineDetails } from "./provisionalTypes";

type SourceLine = ProvisionalLine & { sourceTable?: string | null; sourceId?: string | null };
export type ProvisionalExceptionDetail = {
  id: string;
  attendanceDate: string;
  scope: "day" | "period";
  attendanceGenerated?: boolean;
  quantityMinutes: number | null;
  amountOverride: string | number | null;
  dtrOverrideSource: string | null;
  accountTypeSnapshot: string | null;
};
export type ProvisionalManualDetail = {
  id: string;
  sourceTable?: string | null;
  sourceId?: string | null;
  hours: number;
  minutes: number;
};
export type ProvisionalLineContext = {
  startDate: string;
  endDate: string;
  exceptions: readonly ProvisionalExceptionDetail[];
  manualLines?: readonly ProvisionalManualDetail[];
  installments?: readonly { id: string; dueDate: string }[];
  dayAdjustments?: readonly { day: string; actualLateMinutes: number; penaltyMinutes: number }[];
  projectedDays?: ReadonlySet<string>;
  postedCreditsApplied?: boolean;
};

const wholeMinutes = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
function validDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
}
const cents = (value: number) => Math.round(Number(value.toFixed(2)) * 100);
const quantityOnly = new Set(["DTR_TARDINESS", "DTR_UNDERTIME", "DTR_HOLD_TARDINESS", "DTR_HOLD_UNDERTIME"]);

/** Read-model annotation only. Source IDs select evidence, never infer dates from
 * generated IDs, labels, amounts, or array positions. No sorting or recalculation. */
export function withProvisionalLineDetails<T extends SourceLine>(lines: readonly T[], context: ProvisionalLineContext): Array<T & { details: ProvisionalLineDetails }> {
  const exceptions = new Map(context.exceptions.map(row => [row.id, row]));
  const manual = new Map((context.manualLines ?? []).map(row => [row.id, row]));
  const installments = new Map((context.installments ?? []).map(row => [row.id, row]));
  const adjustments = new Map((context.dayAdjustments ?? []).map(row => [row.day, row]));
  return lines.map(line => {
    const details: ProvisionalLineDetails = { scope: "period", notes: [] };
    if (validDate(context.startDate) && validDate(context.endDate) && context.startDate <= context.endDate) {
      details.startDate = context.startDate; details.endDate = context.endDate;
    }
    const manualLine = line.sourceTable === "manual_payroll_entry_lines" && line.sourceId ? manual.get(line.sourceId) : undefined;
    const source = line.sourceTable === "employee_payroll_exception_rows" && line.sourceId ? exceptions.get(line.sourceId)
      : manualLine?.sourceTable === "employee_payroll_exception_rows" && manualLine.sourceId ? exceptions.get(manualLine.sourceId) : undefined;
    if (source) {
      if (source.scope === "day" && validDate(source.attendanceDate)) {
        details.scope = "day"; details.workDate = source.attendanceDate;
        delete details.startDate; delete details.endDate;
        if (source.attendanceGenerated && source.dtrOverrideSource && context.projectedDays?.has(source.attendanceDate)) details.projected = true;
      } else details.notes.push("Attendance quantity for the calculation period; not assigned to one workday.");
      if (wholeMinutes(source.quantityMinutes)) { details.quantityMinutes = source.quantityMinutes; details.quantityUnit = "hours"; }
      if (manualLine && wholeMinutes(manualLine.hours) && wholeMinutes(manualLine.minutes) && manualLine.minutes < 60) {
        details.quantityMinutes = manualLine.hours * 60 + manualLine.minutes; details.quantityUnit = "hours";
      }
      const verifiedZeroTime = line.amount === 0 && quantityOnly.has(source.dtrOverrideSource ?? "") && (!manualLine || details.quantityMinutes === source.quantityMinutes);
      if (verifiedZeroTime) details.notes.push("Time adjustment already reflected in regular pay; no additional monetary deduction.");
      else if (source.accountTypeSnapshot === "Unpaid Leaves/Absences" && line.amount === 0) details.notes.push("Unpaid leave/absence quantity shown for reference; this line adds no monetary deduction.");
      if (source.dtrOverrideSource === "DTR_TARDINESS" && details.scope === "day") {
        const adjustment = adjustments.get(source.attendanceDate);
        if (adjustment && wholeMinutes(adjustment.actualLateMinutes) && wholeMinutes(adjustment.penaltyMinutes) && adjustment.actualLateMinutes + adjustment.penaltyMinutes === source.quantityMinutes) {
          details.actualLateMinutes = adjustment.actualLateMinutes;
          details.penaltyMinutes = adjustment.penaltyMinutes;
          if (adjustment.penaltyMinutes) details.notes.push("Includes the period's accumulated-lateness penalty allocated to this workday; it is not additional lateness on this date.");
        } else details.notes.push("Tardiness quantity can include an accumulated period penalty; it is not necessarily this day's clock lateness.");
      }
      if (source.amountOverride != null && !verifiedZeroTime) details.notes.push("Uses a specified amount; time multiplied by rate may not equal this line.");
      // Only current generated attendance rows have a verified minute basis.
      // Rounding a display rate is permitted only if it still reproduces the
      // authoritative line cents. Never derive a rate by dividing the amount.
      if (!manualLine && !context.postedCreditsApplied && source.attendanceGenerated && source.scope === "day" && source.amountOverride == null && ["DTR_WORKED", "DTR_REGULAR_OVERTIME"].includes(source.dtrOverrideSource ?? "") && wholeMinutes(details.quantityMinutes) && details.quantityMinutes > 0 && line.rate != null && Number.isFinite(line.rate) && line.rate > 0) {
        const displayedRate = Number(line.rate.toFixed(2));
        if (cents(details.quantityMinutes / 60 * line.rate) === cents(line.amount) && cents(details.quantityMinutes / 60 * displayedRate) === cents(line.amount)) details.formula = { quantityMinutes: details.quantityMinutes, hourlyRate: line.rate };
      }
    } else if (line.sourceTable === "employees_leave_records") {
      details.quantityUnit = "days";
      details.notes.push("Approved leave combined for the calculation period; no individual workday allocation is available on this line.");
    } else if (line.sourceTable === "loan_installments") {
      const installment = line.sourceId ? installments.get(line.sourceId) : undefined;
      if (validDate(installment?.dueDate)) details.dueDate = installment.dueDate;
      details.notes.push("Scheduled loan installment, not a charge for one workday.");
    } else if (["statutory_rule_versions", "employee_contribution_groups"].includes(line.sourceTable ?? "")) {
      details.notes.push("Contribution or tax calculated for the payroll period, using the configured basis and payment schedule.");
    } else if (line.sourceTable === "payroll_run_employees") {
      details.notes.push("Recovery from a prior payroll balance; not a deduction for a current workday.");
    } else if (line.sourceTable === "employees_recurring_entries") {
      details.notes.push("Recurring amount applicable to this payroll period.");
    } else if (line.sourceTable === "employee_salary_changes") {
      details.notes.push("Salary adjustment applied to this payroll calculation; this line is informational.");
    } else if (line.sourceTable === "attendance_daily_summaries") {
      details.notes.push("Combined attendance amount for the calculation period; no individual workday allocation is available on this line.");
      if (line.lineType === "Earning") details.quantityUnit = "hours";
      if (line.lineType === "Information" && line.code === "LATE-UT" && wholeMinutes(line.quantity)) { details.quantityMinutes = line.quantity; details.quantityUnit = "hours"; }
    } else if (line.sourceTable === "employee_attendance_period_overrides") {
      details.notes.push("Approved attendance quantity for the whole calculation period; no individual workday allocation.");
      if (line.lineType === "Earning") details.quantityUnit = "hours";
    } else if (!line.sourceTable) {
      details.notes.push("Period-level calculation; no verified individual workday allocation.");
    } else if (!line.sourceTable.startsWith("manual_payroll_")) details.notes.push("Source details do not provide a verified workday; shown with period items.");
    if (line.sourceTable?.startsWith("manual_payroll_")) {
      details.notes.push(source ? "Saved manual payroll line linked to this attendance item; its saved amount is retained." : "Saved manual payroll amount; no verified workday allocation is available.");
      if (!source && manualLine && wholeMinutes(manualLine.hours) && wholeMinutes(manualLine.minutes) && manualLine.minutes < 60 && manualLine.hours * 60 + manualLine.minutes > 0) {
        details.quantityMinutes = manualLine.hours * 60 + manualLine.minutes; details.quantityUnit = "hours";
      }
    }
    if (context.postedCreditsApplied) details.notes.push("Amount shown is the remaining amount after applicable posted-pay credits; quantity and rate may describe the original entitlement.");
    if (details.projected) details.notes.push("Assumes this confirmed shift is completed; these are forecast earnings, not recorded attendance.");
    return { ...line, details };
  });
}
