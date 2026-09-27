import assert from "node:assert/strict";
import {
  getWeeklyPatternIdsToPrune,
  selectLiveWeeklyPattern,
  type WeeklyPatternPruneCandidate,
} from "@/lib/payroll/weeklyPatternPruning";

function applyPrunePlan(
  patterns: WeeklyPatternPruneCandidate[],
  keepPatternId?: number | null,
) {
  const pruneIds = new Set(getWeeklyPatternIdsToPrune(patterns, keepPatternId));
  return patterns.filter((pattern) => !pruneIds.has(pattern.id));
}

const employeeId = "00000000-0000-0000-0000-000000000001";
const patterns: WeeklyPatternPruneCandidate[] = [
  {
    id: 10,
    employeeId,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  },
  {
    id: 25,
    employeeId,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  },
  {
    id: 30,
    employeeId,
    effectiveFrom: "2026-02-01",
    effectiveTo: "2026-02-28",
  },
];

assert.equal(
  selectLiveWeeklyPattern(patterns)?.id,
  25,
  "The live manager weekly pattern should prefer open-ended rows, then highest id.",
);

assert.deepEqual(
  getWeeklyPatternIdsToPrune(patterns),
  [10, 30],
  "Default pruning should keep only the live pattern.",
);

assert.deepEqual(
  applyPrunePlan(patterns, 10).map((pattern) => pattern.id),
  [10],
  "Individual manager save should keep the saved pattern and delete every other row.",
);

assert.deepEqual(
  applyPrunePlan(patterns, 25).map((pattern) => pattern.id),
  [25],
  "Weekly Base Schedule save should keep the current grid pattern and delete older rows.",
);

console.log("Manager weekly schedule pruning verification passed.");
