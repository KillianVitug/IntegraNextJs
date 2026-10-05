import { manilaWallTime, sourceDayOffset, type SourcePunch } from "./attendanceSourceClient";

export type ManualPunch = { type: "IN" | "OUT"; localDateTime: string };
export type ResolutionKind = "Manual" | "NoAttendance" | "SourceVoid" | "SourceRestore";
export type ResolutionRequest = { periodId: string; sourceId: string; version: string; kind: ResolutionKind; reason: string; evidence: string; confirmed: boolean; manualPunches: ManualPunch[]; eventIds: string[] };
export type ResolutionPerson = { sourceId: string; name: string; employeeId: string | null; employeeNo: string | null; employeeName: string | null; classification: string; version: string; records: SourcePunch[]; relevantIds: string[]; issues: string[]; contextOnly: boolean; resolution: { id: string; state: string; kind: string; reason: string; evidence: string; manualPunches: ManualPunch[]; eventIds: string[] } | null };
export type ResolutionHistory = { id: string; sourceId: string; kind: string; state: string; reason: string; evidence: string; createdAt: string; updatedAt: string; actor: string; reviewer: string | null; manualPunches: ManualPunch[]; eventIds: string[]; result: string | null };
export type AttendanceReadiness = { periodId: string; code: string; startDate: string; endDate: string; periodOpen: boolean; runState: string | null; syncedAt: string | null; needsSync: boolean; summariesOutdated: boolean; ready: boolean; blockers: string[]; counts: Record<string, number>; people: ResolutionPerson[]; history: ResolutionHistory[]; historyHasMore: boolean; sourceCorrectionsEnabled: boolean };

export const originalPunchDateTime = (iso: string) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).format(new Date(iso));
export const chronological = (a: SourcePunch, b: SourcePunch) => a.capturedAt.localeCompare(b.capturedAt) || a.eventId.localeCompare(b.eventId);
export function periodAttendanceScope(records: SourcePunch[], start: string, end: string) {
  const relevant = new Set(records.filter(p => { const day = manilaWallTime(p.capturedAt).date; return day >= start && day <= end; }).map(p => p.eventId));
  const boundary = new Set<string>(), groups = new Map<string, SourcePunch[]>();
  for (const p of records.filter(p => p.status === "VALID")) { const list = groups.get(p.employeeId) ?? []; list.push(p); groups.set(p.employeeId, list); }
  for (const list of groups.values()) {
    list.sort(chronological);
    list.forEach((p, i) => {
      const day = manilaWallTime(p.capturedAt).date;
      if (day === start && p.type === "OUT") {
        if (list[i - 1]?.type === "IN" && Date.parse(p.capturedAt)-Date.parse(list[i-1].capturedAt)<=86400000) relevant.add(list[i - 1].eventId); else boundary.add(p.eventId);
      }
      if (day === end && p.type === "IN") {
        if (list[i + 1]?.type === "OUT" && Date.parse(list[i+1].capturedAt)-Date.parse(p.capturedAt)<=86400000) relevant.add(list[i + 1].eventId); else boundary.add(p.eventId);
      }
    });
  }
  return { relevant, boundary };
}
export function validateManualSequence(records: SourcePunch[], manual: ManualPunch[], start: string, end: string) {
  const scope = periodAttendanceScope(records, start, end);
  const valid = records.filter(p => scope.relevant.has(p.eventId) && p.status === "VALID");
  if (!valid.length && !manual.length) return "Supply the verified full shift or confirm no attendance with evidence.";
  if (valid.some(p => p.clockFlag)) return "A device clock warning needs source investigation before approving times.";
  const supported = new Set(["NO_EARLIER_IN", "NO_FOLLOWING_OUT", "CONSECUTIVE_IN", "CONSECUTIVE_OUT", "CLOSE_PUNCHES_ACROSS_PHONES"]);
  if (valid.some(p => !p.reviewResolved && p.reviewFlags.some(f => !supported.has(f)))) return "An additional source warning requires investigation before approving this sequence.";
  if (manual.length > 62) return "Review at most 62 missing punches in one proposal.";
  const sequence = valid.map(p => ({ type: p.type, at: Date.parse(p.capturedAt) }));
  for (const p of manual) {
    if (!["IN", "OUT"].includes(p.type) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(p.localDateTime)) return "Enter a valid date and time for each manual IN or OUT.";
    const at = Date.parse(p.localDateTime + "+08:00");
    if (!Number.isFinite(at) || !manilaWallTime(new Date(at).toISOString()).timestamp.replace(" ", "T").startsWith(p.localDateTime)) return "One of the manual dates or times is invalid.";
    const day = p.localDateTime.slice(0, 10);
    if (day < sourceDayOffset(start, -1) || day > sourceDayOffset(end, 1)) return "Manual times must belong to this period or its adjacent overnight day.";
    sequence.push({ type: p.type, at });
  }
  sequence.sort((a, b) => a.at - b.at);
  if (sequence.some((p, i) => i > 0 && p.at === sequence[i - 1].at)) return "Two punches have the same time. Review duplicate records first.";
  if (sequence.length % 2 || sequence.some((p, i) => p.type !== (i % 2 ? "OUT" : "IN"))) return "The proposed sequence still has a missing or repeated IN/OUT. Correct confirmed duplicates or add the other verified missing time.";
  for (let i = 0; i < sequence.length; i += 2) {
    const inDay = manilaWallTime(new Date(sequence[i].at).toISOString()).date, outDay = manilaWallTime(new Date(sequence[i + 1].at).toISOString()).date;
    if (inDay > end || outDay < start) return "A proposed pair is outside this payroll period.";
    if (outDay > sourceDayOffset(inDay, 1)) return "This spans more than an overnight workday. Ask payroll to review the shift policy and evidence.";
  }
  return null;
}
