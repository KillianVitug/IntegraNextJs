import { timingSafeEqual } from "node:crypto";

export function attendanceSchedulerAuthorized(enabled: boolean, configured: string, provided: string) {
  if (!enabled || configured.length < 32) return false;
  const expected = Buffer.from(`Bearer ${configured}`);
  const actual = Buffer.from(provided);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
