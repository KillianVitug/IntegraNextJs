import { db, type DbInsertClient } from "@/db";
import { adminAuditEvents, payrollRunEvents } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/server";

export type AdminActor = {
  userId: string;
  email: string;
};

function serializeDetails(details: unknown) {
  if (details == null) return null;
  if (typeof details === "string") return details;

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

export async function requireAdminActor(): Promise<AdminActor> {
  const auth = await requireAdmin();

  return {
    userId: auth.accountId,
    email: auth.email,
  };
}

export async function recordAdminAuditEvent(args: {
  actorUserId: string;
  entityType: string;
  entityId?: string | number | null;
  action: string;
  details?: unknown;
  database?: DbInsertClient;
}) {
  const database = args.database ?? db;

  await database.insert(adminAuditEvents).values({
    actorUserId: args.actorUserId,
    entityType: args.entityType,
    entityId: args.entityId != null ? String(args.entityId) : null,
    action: args.action,
    details: serializeDetails(args.details),
  });
}

export async function recordPayrollRunEvent(args: {
  payrollRunId: string;
  actorUserId: string;
  eventType: "Computed" | "MarkedStale" | "Reviewed" | "Approved" | "Posted" | "Voided";
  fromStatus?: "Draft" | "Stale" | "Reviewed" | "Approved" | "Posted" | "Void" | null;
  toStatus?: "Draft" | "Stale" | "Reviewed" | "Approved" | "Posted" | "Void" | null;
  notes?: string | null;
  database?: DbInsertClient;
}) {
  const database = args.database ?? db;

  await database.insert(payrollRunEvents).values({
    payrollRunId: args.payrollRunId,
    actorUserId: args.actorUserId,
    eventType: args.eventType,
    fromStatus: args.fromStatus ?? null,
    toStatus: args.toStatus ?? null,
    notes: args.notes ?? null,
  });
}
