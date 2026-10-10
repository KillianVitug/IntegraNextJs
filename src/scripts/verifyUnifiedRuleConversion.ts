import assert from "node:assert/strict";
import { convertUnifiedRuleSnapshot, partitionUnifiedRuleRange } from "@/lib/scheduling/unified-rule-conversion";
import type { ScheduleSnapshot } from "@/lib/scheduling/workspace-types";

type Break = ScheduleSnapshot["breaks"][number];
const gap = (slotKey: Break["slotKey"], fromTime: string, toTime: string, unpaid: number): Break => ({ slotKey, fromTime, toTime, deduct: unpaid > 0, deductHours: Math.floor(unpaid / 60), deductMinutes: unpaid % 60, label: slotKey, sortOrder: 1, requiresPunches: false });
const base: ScheduleSnapshot = { kind: "shift", shiftTableId: 19, shiftName: "Reviewed source", shiftCode: "SPLIT - N", checkInTime: "08:00:00", checkOutTime: "21:00:00", breakMinutes: 270, paidBreakMinutes: 0, graceMinutes: 0, hoursPerDay: 8.5, isFlexible: false, calculationPolicy: "legacy", punchPolicy: "legacy", breaks: [gap("mid_break", "11:00:00", "15:30:00", 270)] };
const old = structuredClone(base);
const converted = convertUnifiedRuleSnapshot(base, { reviewedSplitGapSlots: ["mid_break"] });
assert.equal(converted.calculationPolicy, "eight_hour_day");
assert.equal(converted.punchPolicy, "split_gaps");
assert.equal(converted.breaks[0].requiresPunches, true);
assert.deepEqual(base, old);
assert.deepEqual({ ...converted, calculationPolicy: old.calculationPolicy, punchPolicy: old.punchPolicy, breaks: converted.breaks.map(row => ({ ...row, requiresPunches: false })) }, old, "Conversion preserves every original business value except reviewed calculation/punch metadata");
converted.breaks[0].fromTime = "00:00";
assert.equal(base.breaks[0].fromTime, "11:00:00", "Converted snapshots share no mutable break references");

for (const minutes of [0, 30, 60]) {
  const ordinary = { ...base, shiftCode: "Name must not decide punches", checkOutTime: "17:00", breaks: [gap("mid_break", "12:00", "13:00", minutes)], breakMinutes: minutes, paidBreakMinutes: 60 - minutes, hoursPerDay: 9 - minutes / 60 };
  const result = convertUnifiedRuleSnapshot(ordinary, { reviewedSplitGapSlots: [] });
  assert.equal(result.punchPolicy, "outer");
  assert.deepEqual(result.breaks, ordinary.breaks, "Paid, part-paid and unpaid ordinary breaks retain payment and timing");
}
const half = { ...base, checkOutTime: "12:00", breaks: [gap("break_1", "10:00", "10:15", 0)], breakMinutes: 0, paidBreakMinutes: 15, hoursPerDay: 4 };
assert.equal(convertUnifiedRuleSnapshot(half, { reviewedSplitGapSlots: [] }).hoursPerDay, 4);
const night = { ...base, checkInTime: "20:00", checkOutTime: "09:00", breaks: [gap("mid_break", "23:00", "03:30", 270)] };
assert.deepEqual(convertUnifiedRuleSnapshot(night, { reviewedSplitGapSlots: ["mid_break"] }).breaks[0], { ...night.breaks[0], requiresPunches: true });
const overtime = { ...base, breaks: [...base.breaks, gap("ot_break_1", "23:45", "00:15", 15)] };
assert.deepEqual(convertUnifiedRuleSnapshot(overtime, { reviewedSplitGapSlots: ["mid_break"] }).breaks[1], overtime.breaks[1], "Overnight part-paid overtime breaks are preserved separately");
assert.throws(() => convertUnifiedRuleSnapshot(overtime, { reviewedSplitGapSlots: ["ot_break_1"] }), /regular break/);

// F/L-style ordering: an ordinary early break comes before the reviewed primary split gap.
for (const shiftCode of ["SPLIT - F", "SPLIT - L"]) {
  const earlyBreak = { ...base, shiftCode, breaks: [gap("break_1", "09:00", "09:30", 30), ...base.breaks], breakMinutes: 300, hoursPerDay: 8 };
  const result = convertUnifiedRuleSnapshot(earlyBreak, { reviewedSplitGapSlots: ["mid_break"] });
  assert.equal(result.breaks[0].requiresPunches, false);
  assert.equal(result.breaks[1].requiresPunches, true);
}
const three = { ...base, checkOutTime: "20:00", breaks: [gap("mid_break", "11:00", "12:00", 60), gap("break_2", "15:00", "16:00", 60)], breakMinutes: 120, hoursPerDay: 10 };
assert.equal(convertUnifiedRuleSnapshot(three, { reviewedSplitGapSlots: ["mid_break", "break_2"] }).breaks.filter(row => row.requiresPunches).length, 2);
assert.throws(() => convertUnifiedRuleSnapshot(base), /mapping/);
assert.throws(() => convertUnifiedRuleSnapshot(base, { reviewedSplitGapSlots: ["break_1"] }), /no complete/);
assert.throws(() => convertUnifiedRuleSnapshot(base, { reviewedSplitGapSlots: ["mid_break", "mid_break"] }), /duplicate/);
assert.throws(() => convertUnifiedRuleSnapshot({ ...base, checkInTime: null }, { reviewedSplitGapSlots: [] }), /complete/);
assert.throws(() => convertUnifiedRuleSnapshot({ ...base, checkInTime: "08:00:01" }, { reviewedSplitGapSlots: [] }), /whole-minute/);
assert.throws(() => convertUnifiedRuleSnapshot({ ...base, breaks: [] }, { reviewedSplitGapSlots: [] }), /hours|Break times/);
assert.throws(() => convertUnifiedRuleSnapshot({ ...base, breakMinutes: 60 }, { reviewedSplitGapSlots: ["mid_break"] }), /totals/);
assert.throws(() => convertUnifiedRuleSnapshot({ ...base, paidBreakMinutes: 15 }, { reviewedSplitGapSlots: ["mid_break"] }), /totals/);
assert.throws(() => convertUnifiedRuleSnapshot({ ...base, breaks: [...base.breaks, gap("break_1", "11:30", "12:00", 30)] }, { reviewedSplitGapSlots: ["mid_break"] }), /overlap/);
assert.throws(() => convertUnifiedRuleSnapshot({ ...base, breaks: [...base.breaks, gap("ot_break_1", "11:30", "12:00", 30)] }, { reviewedSplitGapSlots: ["mid_break"] }), /overlap/);
assert.throws(() => convertUnifiedRuleSnapshot({ ...base, breaks: [gap("mid_break", "08:00", "12:30", 270)] }, { reviewedSplitGapSlots: ["mid_break"] }), /before and after/);
assert.throws(() => convertUnifiedRuleSnapshot({ ...base, breaks: [{ ...base.breaks[0], deduct: false }] }, { reviewedSplitGapSlots: ["mid_break"] }), /payment/);
assert.throws(() => convertUnifiedRuleSnapshot({ ...base, breaks: [base.breaks[0], base.breaks[0]] }, { reviewedSplitGapSlots: ["mid_break"] }), /duplicate/);
for (const kind of ["rest", "unconfigured"] as const) {
  const value = { ...base, kind, checkInTime: null, checkOutTime: null };
  assert.deepEqual(convertUnifiedRuleSnapshot(value), value);
  assert.notEqual(convertUnifiedRuleSnapshot(value), value);
}

assert.deepEqual(partitionUnifiedRuleRange({ effectiveFrom: "2026-09-15", effectiveTo: "2026-10-15" }), { historical: { effectiveFrom: "2026-09-15", effectiveTo: "2026-09-30" }, eligible: [{ effectiveFrom: "2026-10-01", effectiveTo: "2026-10-15" }], blocked: [] });
assert.deepEqual(partitionUnifiedRuleRange({ effectiveFrom: "2026-09-01", effectiveTo: "2026-09-30" }), { historical: { effectiveFrom: "2026-09-01", effectiveTo: "2026-09-30" }, eligible: [], blocked: [] });
assert.deepEqual(partitionUnifiedRuleRange({ effectiveFrom: "2026-10-01", effectiveTo: null }).eligible, [{ effectiveFrom: "2026-10-01", effectiveTo: null }]);
const protections = [{ startDate: "2026-10-02", endDate: "2026-10-04", status: "Approved" as const }, { startDate: "2026-10-04", endDate: "2026-10-06", status: "Posted" as const }, { startDate: "2026-10-08", endDate: null, status: "Closed" as const }];
const protectionCopy = structuredClone(protections);
const plan = partitionUnifiedRuleRange({ effectiveFrom: "2026-09-01", effectiveTo: null }, protections);
assert.deepEqual(plan.eligible, [{ effectiveFrom: "2026-10-01", effectiveTo: "2026-10-01" }, { effectiveFrom: "2026-10-07", effectiveTo: "2026-10-07" }]);
assert.equal(plan.blocked.find(row => row.effectiveFrom === "2026-10-04")?.protections.length, 2);
assert.equal(plan.blocked.at(-1)?.effectiveTo, null);
for (let number = 1; number <= 15; number++) {
  const day = `2026-10-${String(number).padStart(2, "0")}`;
  const contains = (row: { effectiveFrom: string; effectiveTo: string | null }) => row.effectiveFrom <= day && (!row.effectiveTo || row.effectiveTo >= day);
  assert.equal([...plan.eligible, ...plan.blocked].filter(contains).length, 1, `Every affected day is partitioned exactly once: ${day}`);
  assert.equal(plan.blocked.some(contains), protections.some(row => row.startDate <= day && (!row.endDate || row.endDate >= day)), `Protection is never bypassed or overextended: ${day}`);
}
assert.deepEqual(protections, protectionCopy);
plan.blocked[0].protections[0].startDate = "2000-01-01";
assert.deepEqual(protections, protectionCopy);
assert.deepEqual(partitionUnifiedRuleRange({ effectiveFrom: "2026-10-01", effectiveTo: "2026-10-01" }, [{ startDate: "2026-09-01", endDate: "2026-10-01", status: "Posted" }]).eligible, []);
assert.throws(() => partitionUnifiedRuleRange({ effectiveFrom: "2026-02-30", effectiveTo: null }), /valid calendar/);
assert.throws(() => partitionUnifiedRuleRange({ effectiveFrom: "2026-10-02", effectiveTo: "2026-10-01" }), /precede/);
console.log("PASS unified-rule conversion: exact retained times/payments, explicit split mapping, paid/partial/overnight/three-session validation, immutable inputs, October 1 partition and closed/approved/posted protection.");
