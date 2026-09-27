import assert from "node:assert/strict";
import {
  computeAccumulatedLatePenaltyMinutes,
  computeDisplayedDtrWorkedMinutes,
  computeNetDtrWorkedMinutes,
  computePayrollTardinessMinutes,
} from "@/lib/payroll/dtrOverrides";

assert.equal(
  computeAccumulatedLatePenaltyMinutes(179),
  0,
  "Late minutes below 3 hours should not add a penalty."
);

assert.equal(
  computePayrollTardinessMinutes(179),
  179,
  "179 late minutes should stay 179 payroll tardiness minutes."
);

assert.equal(
  computePayrollTardinessMinutes(180),
  480,
  "180 late minutes should add one 5-hour penalty."
);

assert.equal(
  computePayrollTardinessMinutes(360),
  960,
  "360 late minutes should add two 5-hour penalties."
);

assert.equal(
  computeNetDtrWorkedMinutes({
    presentDays: 1,
    lateMinutes: 180,
    undertimeMinutes: 0,
  }),
  0,
  "Worked minutes should subtract adjusted tardiness minutes and clamp at zero."
);

assert.equal(
  computeNetDtrWorkedMinutes({
    presentDays: 1,
    lateMinutes: 360,
    undertimeMinutes: 0,
    workedMinutesOverride: 480,
  }),
  480,
  "Worked-minutes override should remain absolute."
);

assert.equal(
  computeDisplayedDtrWorkedMinutes({
    workedMinutes: 479,
    scheduledMinutes: 480,
    lateMinutes: 0,
    undertimeMinutes: 0,
  }),
  479,
  "Displayed DTR worked minutes should keep raw worked minutes when there is no late or undertime."
);

assert.equal(
  computeDisplayedDtrWorkedMinutes({
    workedMinutes: 479,
    scheduledMinutes: 480,
    lateMinutes: 0,
    undertimeMinutes: 30,
  }),
  450,
  "30 undertime minutes should display a rounded 7h 30m worked day."
);

assert.equal(
  computeDisplayedDtrWorkedMinutes({
    workedMinutes: 449,
    scheduledMinutes: 480,
    lateMinutes: 0,
    undertimeMinutes: 60,
  }),
  420,
  "60 undertime minutes should display a rounded 7h worked day."
);

assert.equal(
  computeDisplayedDtrWorkedMinutes({
    workedMinutes: 390,
    scheduledMinutes: 480,
    lateMinutes: 60,
    undertimeMinutes: 30,
  }),
  390,
  "Displayed DTR worked minutes should subtract both late and undertime from scheduled minutes."
);

assert.equal(
  computeDisplayedDtrWorkedMinutes({
    workedMinutes: 570,
    scheduledMinutes: 600,
    lateMinutes: 0,
    undertimeMinutes: 30,
  }),
  570,
  "Displayed DTR worked minutes should respect non-8-hour scheduled minutes."
);

console.log("DTR late penalty checks passed.");
