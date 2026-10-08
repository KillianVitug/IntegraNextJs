import type { WorkRecord } from "./attendanceWorkbenchModel";
import { workDate } from "./attendanceWorkbenchModel";
import type { SourcePunch } from "./attendanceSourceClient";

/** A payroll decision is durable evidence, independent of phone delivery. */
export type AdminAttendanceDecision = {
  kind: "AdminDecision";
  actor: string;
  approvedAt: string;
  reason: string;
  warnings: string[];
  days: string[];
  records: WorkRecord[];
  sourceRecords: WorkRecord[];
  keptIncomingDigest?: string;
};

export function adminDecision(value: unknown): AdminAttendanceDecision | null {
  const item = value as Partial<AdminAttendanceDecision> | null;
  return item?.kind === "AdminDecision" && Array.isArray(item.records) && Array.isArray(item.days)
    ? item as AdminAttendanceDecision : null;
}

export function attendanceEvidence(records: WorkRecord[]) {
  // VOID/excluded captures remain visible history, but have no payable input.
  // Removing/restoring a VALID capture still changes this set and needs review.
  return records.filter(r => r.source === "API" && r.status === "VALID" && !r.excluded).map(r => ({
    id: r.id, employeeId: r.employeeId, type: r.type, at: r.at,
    status: r.status, clockVerified: !!r.clockVerified,
  })).sort((a, b) => a.id.localeCompare(b.id));
}

export function applyAdminDecisions(records: WorkRecord[], decisions: AdminAttendanceDecision[]) {
  let effective = records;
  // Apply oldest first; a subsequent explicit approval supersedes its reviewed scope.
  for (const decision of decisions) {
    const ids = new Set([...decision.sourceRecords, ...decision.records].map(r => r.id));
    effective = effective.filter(r => !decision.days.includes(workDate(r.at)) && !ids.has(r.id));
    effective = [...effective, ...decision.records];
  }
  return [...new Map(effective.map(r => [r.id, r])).values()].sort((a, b) => a.at.localeCompare(b.at));
}

export function decisionIncomingRecords(records: WorkRecord[], decision: AdminAttendanceDecision) {
  const ids = new Set(decision.sourceRecords.map(r => r.id));
  return records.filter(r => decision.days.includes(workDate(r.at)) || ids.has(r.id));
}

/** A historical receipt proves application only while every exact source value
 * and revision still matches. It never authorizes another source write. */
export function historicalReceiptMatches(receipt: Record<string, unknown> | null, punches: SourcePunch[]) {
  if (receipt?.state !== "Applied" || !Array.isArray(receipt.changes) || !receipt.changes.length) return false;
  return receipt.changes.every((change: { event_id?: string; after_json?: string; revision?: string }) => {
    const punch = punches.find(p => p.eventId === change.event_id);
    if (!punch || !change.after_json || !change.revision || punch.effectiveRevision !== change.revision) return false;
    try {
      const after = JSON.parse(change.after_json) as Record<string, unknown>;
      return after.employeeId === punch.employeeId && after.type === punch.type && after.capturedAt === punch.capturedAt && after.status === punch.status && !!after.clockVerified === !!punch.clockVerified;
    } catch { return false; }
  });
}
