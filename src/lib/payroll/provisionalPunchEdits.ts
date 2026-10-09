import type { WorkChange, WorkDraft, WorkRecord } from "./attendanceWorkbenchModel";

function samePunch(a: WorkChange, b: WorkChange): boolean {
  if (a.day !== b.day) return false;
  if (a.eventId || b.eventId) return !!a.eventId && a.eventId === b.eventId;
  return a.rawLogId !== undefined && a.rawLogId === b.rawLogId;
}

export function changesForPunch(draft: WorkDraft | null, record: WorkRecord, day: string): WorkChange[] {
  const target: WorkChange = { id: "", day, kind: "Direction", reason: "", evidence: "", verified: false,
    ...(record.source === "API" ? { eventId: record.id } : { rawLogId: record.rawLogId }) };
  return draft?.changes.filter(change => samePunch(change, target)) ?? [];
}

/** Reselecting a punch action preserves entered values and its stable edit ID. */
export function upsertPunchChange(draft: WorkDraft, change: WorkChange): WorkDraft {
  if (!change.eventId && change.rawLogId === undefined) return { ...draft, changes: [...draft.changes, change] };
  const existing = draft.changes.find(value => samePunch(value, change) && value.kind === change.kind);
  const opposite = { Void: "Restore", Restore: "Void", Exclude: "Retain", Retain: "Exclude" }[change.kind as "Void" | "Restore" | "Exclude" | "Retain"];
  let retained = false;
  const changes = draft.changes.filter(value => {
    if (!samePunch(value, change)) return true;
    if (value.kind === opposite) return false;
    if (value.kind !== change.kind) return true;
    if (retained) return false;
    retained = true;
    return true;
  });
  return { ...draft, changes: existing ? changes : [...changes, change] };
}

/** Keep the original evidence version for remaining days, including stale drafts. */
export function removeDraftChanges(draft: WorkDraft, ids: readonly string[]): WorkDraft | null {
  const changes = draft.changes.filter(change => !ids.includes(change.id));
  if (!changes.length) return null;
  const days = [...new Set(changes.map(change => change.day))].sort();
  return { ...draft, changes, days, version: draft.version.split("|").filter(value => days.some(day => value.startsWith(`${day}:`))).join("|") };
}
