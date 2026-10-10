import { SHIFT_BREAK_SLOT_DEFINITIONS, deriveShiftMetricsFromTable, type ShiftTableReadModel } from "@/lib/shifts";
import type { InsertShiftTableSchemaType } from "@/zod-schemas/shiftTable";
import { describeSchedule, shiftTableScheduleSnapshot } from "./presentation";

export type BreakPayment = { pay: "unpaid" | "paid" | "partial"; unpaidMinutes: string };
export type EditorPeriod = { fromTime: string; toTime: string };
export type EditorBreak = EditorPeriod & BreakPayment;
export type ShiftEditorValues = {
  periods: EditorPeriod[];
  gaps: BreakPayment[];
  regularBreaks: EditorBreak[];
  overtimeBreaks: EditorBreak[];
};
export const unpaidBreak = (): BreakPayment => ({ pay: "unpaid", unpaidMinutes: "" });
export const blankEditorBreak = (): EditorBreak => ({ fromTime: "", toTime: "", ...unpaidBreak() });
export function emptyShiftEditor(): ShiftEditorValues {
  return { periods: [{ fromTime: "08:00", toTime: "17:00" }], gaps: [], regularBreaks: [{ fromTime: "12:00", toTime: "13:00", ...unpaidBreak() }], overtimeBreaks: [] };
}

function minutes(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value)) return null;
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}
function clock(value: number) { return `${String(Math.floor(value % 1440 / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
function payment(row: ShiftTableReadModel["breaks"][number]): BreakPayment {
  const from = minutes(row.fromTime ?? ""), to = minutes(row.toTime ?? "");
  const duration = from === null || to === null ? 0 : (to - from + 1440) % 1440;
  const unpaid = row.deduct ? row.deductHours * 60 + row.deductMinutes : 0;
  return { pay: unpaid === 0 ? "paid" : unpaid === duration ? "unpaid" : "partial", unpaidMinutes: String(unpaid) };
}

/** Preserve ordinary/OT break pay settings; only explicit gaps (or legacy's first deducted gap) divide editable periods. */
export function shiftEditorFromTable(row: ShiftTableReadModel): { values: ShiftEditorValues; notices: string[] } {
  const notices: string[] = [];
  const origin = minutes(row.regularStartTime) ?? 0;
  const absolute = (value: string | null) => { const parsed = minutes(value ?? ""); return parsed === null ? Infinity : parsed < origin ? parsed + 1440 : parsed; };
  const active = row.breaks.filter(item => item.fromTime || item.toTime || item.deduct || item.deductHours || item.deductMinutes || item.requiresPunches);
  const regular = active.filter(item => SHIFT_BREAK_SLOT_DEFINITIONS.find(slot => slot.slotKey === item.slotKey)?.category === "regular").sort((a, b) => absolute(a.fromTime) - absolute(b.fromTime));
  let split = regular.filter(item => row.punchPolicy === "split_gaps" && item.requiresPunches);
  if ((!row.punchPolicy || row.punchPolicy === "legacy") && /SPLIT/i.test(`${row.code} ${row.description}`)) {
    const first = regular.find(item => item.deduct && item.deductHours * 60 + item.deductMinutes > 0);
    if (first) split = [first];
    notices.push("The first unpaid break was identified as the existing split gap. Review its times and the other breaks before saving.");
  }
  const periods: EditorPeriod[] = [];
  let cursor = row.regularStartTime;
  for (const item of split) { periods.push({ fromTime: cursor, toTime: item.fromTime ?? "" }); cursor = item.toTime ?? ""; }
  periods.push({ fromTime: cursor, toTime: row.regularEndTime });
  const toEditorBreak = (item: typeof active[number]): EditorBreak => ({ fromTime: item.fromTime ?? "", toTime: item.toTime ?? "", ...payment(item) });
  return { values: { periods, gaps: split.map(payment), regularBreaks: regular.filter(item => !split.includes(item)).map(toEditorBreak), overtimeBreaks: active.filter(item => SHIFT_BREAK_SLOT_DEFINITIONS.find(slot => slot.slotKey === item.slotKey)?.category === "ot").map(toEditorBreak) }, notices };
}

export type ShiftEditorIdentity = { requestId: string; code: string; description?: string; id?: number; expectedVersion?: number };
export type ShiftEditorReview = { payload: InsertShiftTableSchemaType; preview: ShiftTableReadModel };

/** Validate a single civil day timeline (<24h), then encode generated gaps and ordinary breaks into fixed storage slots. */
export function reviewShiftEditor(values: ShiftEditorValues, identity: ShiftEditorIdentity): ShiftEditorReview {
  if (values.periods.length < 1 || values.periods.length > 6) throw new Error("Enter between one and six work periods.");
  if (values.gaps.length !== values.periods.length - 1) throw new Error("Each pair of work periods needs one split gap.");
  if (values.gaps.length + values.regularBreaks.length > 5) throw new Error("Use at most five regular breaks, including split gaps.");
  if (values.overtimeBreaks.length > 2) throw new Error("Use at most two overtime breaks.");
  const origin = minutes(values.periods[0].fromTime);
  if (origin === null) throw new Error("Enter a valid start time for the first work period.");
  const absolute = (value: string) => { const parsed = minutes(value); return parsed === null ? null : parsed < origin ? parsed + 1440 : parsed; };
  const ranges = values.periods.map((item, index) => {
    const from = absolute(item.fromTime), to = absolute(item.toTime);
    if (from === null || to === null || to <= from) throw new Error(`Work period ${index + 1} needs valid start and end times in chronological order.`);
    return { from, to };
  });
  for (let i = 1; i < ranges.length; i++) if (ranges[i].from <= ranges[i - 1].to) throw new Error("Work periods must be in chronological order with a gap between them. Combine touching periods.");
  const finish = ranges[ranges.length - 1].to;
  if (finish - origin >= 1440) throw new Error("The entire schedule must be shorter than 24 hours.");
  const entries: Array<{ from: number; to: number; unpaid: number; split: boolean; category: "regular" | "ot" }> = [];
  const paidMinutes = (item: BreakPayment, duration: number) => {
    if (item.pay === "paid") return 0;
    if (item.pay === "unpaid") return duration;
    const value = Number(item.unpaidMinutes);
    if (!item.unpaidMinutes.trim() || !Number.isInteger(value) || value <= 0 || value >= duration) throw new Error("A partly paid break needs unpaid minutes greater than zero and less than its duration.");
    return value;
  };
  for (let index = 0; index < ranges.length - 1; index++) {
    const from = ranges[index].to, to = ranges[index + 1].from;
    entries.push({ from, to, unpaid: paidMinutes(values.gaps[index], to - from), split: true, category: "regular" });
  }
  const addBreak = (item: EditorBreak, index: number, category: "regular" | "ot") => {
    const from = absolute(item.fromTime), to = absolute(item.toTime);
    const name = category === "ot" ? "Overtime break" : "Break";
    if (from === null || to === null || to <= from) throw new Error(`${name} ${index + 1} needs valid chronological start and end times.`);
    if (category === "regular" && !ranges.some(period => from >= period.from && to <= period.to)) throw new Error(`Break ${index + 1} must fit within a work period, outside split gaps.`);
    entries.push({ from, to, unpaid: paidMinutes(item, to - from), split: false, category });
  };
  values.regularBreaks.forEach((item, index) => addBreak(item, index, "regular"));
  values.overtimeBreaks.forEach((item, index) => addBreak(item, index, "ot"));
  entries.sort((a, b) => a.from - b.from);
  for (let i = 1; i < entries.length; i++) if (entries[i].from < entries[i - 1].to) throw new Error("Break windows must not overlap, including overtime breaks.");
  const regular = entries.filter(item => item.category === "regular"), overtime = entries.filter(item => item.category === "ot");
  const payload: InsertShiftTableSchemaType = {
    ...identity, description: identity.description ?? "Schedule", calculationPolicy: "eight_hour_day", punchPolicy: values.gaps.length ? "split_gaps" : "outer",
    regularStartTime: clock(origin), regularEndTime: clock(finish),
    breaks: SHIFT_BREAK_SLOT_DEFINITIONS.map((definition, index) => {
      const item = definition.category === "regular" ? regular[index] : overtime[index - 5];
      return { slotKey: definition.slotKey, fromTime: item ? clock(item.from) : null, toTime: item ? clock(item.to) : null, deduct: Boolean(item?.unpaid), deductHours: item ? Math.floor(item.unpaid / 60) : 0, deductMinutes: item ? item.unpaid % 60 : 0, requiresPunches: item?.split ?? false };
    }),
  };
  const metrics = deriveShiftMetricsFromTable(payload);
  if (metrics.hoursPerDay <= 0) throw new Error("The schedule must contain paid scheduled time.");
  const preview: ShiftTableReadModel = { id: identity.id ?? 0, code: identity.code, description: payload.description, regularStartTime: payload.regularStartTime, regularEndTime: payload.regularEndTime, calculationPolicy: payload.calculationPolicy, punchPolicy: payload.punchPolicy, deductibleBreakMinutes: metrics.breakMinutes, paidBreakMinutes: metrics.paidBreakMinutes, hoursPerDay: metrics.hoursPerDay, breaks: payload.breaks.map((item, index) => ({ ...item, label: SHIFT_BREAK_SLOT_DEFINITIONS[index].label, sortOrder: index + 1 })) };
  if (!identity.description) { payload.description = describeSchedule(shiftTableScheduleSnapshot(preview)).periodsLabel.slice(0, 80); preview.description = payload.description; }
  return { payload, preview };
}

export function newShiftCode(uuid: string) { return `SHIFT-${uuid.replaceAll("-", "")}`; }

/** Verify persisted definition values, including hidden identity and flags, not just a formatted label. */
export function shiftReadbackMatches(actual: ShiftTableReadModel, expected: ShiftTableReadModel) {
  const definition = (row: ShiftTableReadModel) => ({
    code: row.code, description: row.description, start: row.regularStartTime.slice(0, 5), end: row.regularEndTime.slice(0, 5),
    calculationPolicy: row.calculationPolicy ?? "legacy", punchPolicy: row.punchPolicy ?? "legacy",
    hours: row.hoursPerDay, unpaid: row.deductibleBreakMinutes, paid: row.paidBreakMinutes,
    breaks: SHIFT_BREAK_SLOT_DEFINITIONS.map(slot => {
      const item = row.breaks.find(candidate => candidate.slotKey === slot.slotKey);
      return { slot: slot.slotKey, from: item?.fromTime?.slice(0, 5) || null, to: item?.toTime?.slice(0, 5) || null, deduct: Boolean(item?.deduct), hours: item?.deductHours ?? 0, minutes: item?.deductMinutes ?? 0, punches: Boolean(item?.requiresPunches) };
    }),
  });
  return JSON.stringify(definition(actual)) === JSON.stringify(definition(expected));
}
