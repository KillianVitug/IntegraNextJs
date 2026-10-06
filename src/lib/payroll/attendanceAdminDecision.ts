import type { WorkRecord } from "./attendanceWorkbenchModel";
import { workDate } from "./attendanceWorkbenchModel";

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
  return records.filter(r => r.source === "API").map(r => ({
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
