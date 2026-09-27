export type WeeklyPatternPruneCandidate = {
  id: number;
  employeeId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export function compareLiveWeeklyPatterns<
  T extends WeeklyPatternPruneCandidate,
>(left: T, right: T) {
  const openComparison =
    Number(right.effectiveTo == null) - Number(left.effectiveTo == null);
  if (openComparison !== 0) return openComparison;

  const fromComparison = right.effectiveFrom.localeCompare(left.effectiveFrom);
  if (fromComparison !== 0) return fromComparison;

  return right.id - left.id;
}

export function selectLiveWeeklyPattern<T extends WeeklyPatternPruneCandidate>(
  patterns: T[],
) {
  return [...patterns].sort(compareLiveWeeklyPatterns)[0] ?? null;
}

export function getWeeklyPatternIdsToPrune<
  T extends WeeklyPatternPruneCandidate,
>(patterns: T[], keepPatternId?: number | null) {
  const keepPattern =
    keepPatternId != null
      ? patterns.find((pattern) => pattern.id === keepPatternId) ?? null
      : selectLiveWeeklyPattern(patterns);

  if (!keepPattern) return [];

  return patterns
    .filter((pattern) => pattern.id !== keepPattern.id)
    .map((pattern) => pattern.id);
}
