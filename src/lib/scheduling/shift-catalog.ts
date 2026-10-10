import { createHash } from "node:crypto";
import { compareShiftTableSchedules } from "./presentation";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import {
  adminAuditEvents, employeeShiftAssignments, employeeWeeklyShiftPatternDays,
  managerScheduleChangeRequests, shiftCatalogReceipts, shiftTableBreaks, shiftTables,
} from "@/db/schema";
import { buildShiftTableReadModel, SHIFT_BREAK_SLOT_DEFINITIONS, type ShiftTableReadModel } from "@/lib/shifts";
import { deleteShiftTableSchema, insertShiftTableSchema } from "@/zod-schemas/shiftTable";
import type { ShiftCatalogReceipt, ShiftCatalogUsage } from "./shift-catalog-types";

type CatalogActor = { userId: string; role: string };
type Definition = typeof shiftTables.$inferSelect & { breaks: (typeof shiftTableBreaks.$inferSelect)[] };

function assertAdmin(actor: CatalogActor) {
  if (actor.role !== "ADMIN" || !actor.userId.trim()) throw new Error("Forbidden.");
}

function digest(command: unknown) {
  return createHash("sha256").update(JSON.stringify(command)).digest("hex");
}

async function loadDefinition(database: DbClient, id: number): Promise<Definition | null> {
  const [row] = await database.select().from(shiftTables).where(eq(shiftTables.id, id));
  if (!row) return null;
  const breaks = await database.select().from(shiftTableBreaks)
    .where(eq(shiftTableBreaks.shiftTableId, id)).orderBy(asc(shiftTableBreaks.sortOrder));
  return { ...row, breaks };
}

async function replay(database: DbClient, actor: CatalogActor, requestId: string, requestDigest: string) {
  const [prior] = await database.select().from(shiftCatalogReceipts).where(eq(shiftCatalogReceipts.requestId, requestId));
  if (!prior) return null;
  if (prior.actorUserId !== actor.userId || prior.requestDigest !== requestDigest) {
    throw new Error("This request ID was already used for another command. Reload and try again.");
  }
  return prior.receipt;
}

function assertCurrent(row: Definition | null, expectedVersion: number | undefined): asserts row is Definition {
  if (!row || row.archivedAt || row.version !== expectedVersion) {
    throw new Error("This schedule version has changed or was archived. Reload before saving.");
  }
}

async function recordResult(database: DbClient, actor: CatalogActor, requestDigest: string,
  receipt: ShiftCatalogReceipt, before: Definition | null, after: Definition,
  previousVersionAfter?: Definition) {
  await database.insert(adminAuditEvents).values({
    actorUserId: actor.userId, entityType: "shift_table", entityId: String(receipt.shiftTableId),
    action: `shift_table.${receipt.action}`,
    details: JSON.stringify({ requestId: receipt.requestId, before, after, previousVersionAfter }),
  });
  await database.insert(shiftCatalogReceipts).values({
    requestId: receipt.requestId, actorUserId: actor.userId, requestDigest, receipt,
  });
}

/** Internal reader. The server lookup/API authorize access before calling this function. */
export async function readShiftCatalog(database: DbClient, options: {
  includeArchived?: boolean; includeUsage?: boolean;
} = {}): Promise<ShiftTableReadModel[]> {
  const rows = await database.select().from(shiftTables)
    .where(options.includeArchived ? undefined : isNull(shiftTables.archivedAt))
    .orderBy(asc(shiftTables.code), asc(shiftTables.version));
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const breaks = await database.select().from(shiftTableBreaks)
    .where(inArray(shiftTableBreaks.shiftTableId, ids)).orderBy(asc(shiftTableBreaks.sortOrder));
  const usage = new Map<number, ShiftCatalogUsage>(ids.map(id => [id, { weeklyDays: 0, datedAssignments: 0, pendingRequests: 0 }]));
  if (options.includeUsage) {
    const [weekly, dated, requests] = await Promise.all([
      database.select({ id: employeeWeeklyShiftPatternDays.shiftTableId, count: count() })
        .from(employeeWeeklyShiftPatternDays).where(inArray(employeeWeeklyShiftPatternDays.shiftTableId, ids))
        .groupBy(employeeWeeklyShiftPatternDays.shiftTableId),
      database.select({ id: employeeShiftAssignments.shiftTableId, count: count() })
        .from(employeeShiftAssignments).where(inArray(employeeShiftAssignments.shiftTableId, ids))
        .groupBy(employeeShiftAssignments.shiftTableId),
      database.select({ id: sql<string>`${managerScheduleChangeRequests.payload}->>'shiftTableId'`, count: count() })
        .from(managerScheduleChangeRequests).where(eq(managerScheduleChangeRequests.status, "Pending"))
        .groupBy(sql`${managerScheduleChangeRequests.payload}->>'shiftTableId'`),
    ]);
    for (const row of weekly) if (row.id != null && usage.has(row.id)) usage.get(row.id)!.weeklyDays = row.count;
    for (const row of dated) if (row.id != null && usage.has(row.id)) usage.get(row.id)!.datedAssignments = row.count;
    for (const row of requests) if (usage.has(Number(row.id))) usage.get(Number(row.id))!.pendingRequests = row.count;
  }
  return rows.map(shiftTable => ({
    ...buildShiftTableReadModel({ shiftTable, breaks: breaks.filter(row => row.shiftTableId === shiftTable.id) }),
    ...(options.includeUsage ? { usage: usage.get(shiftTable.id)! } : {}),
  })).sort(compareShiftTableSchedules);
}

export async function saveShiftCatalog(database: DbClient, actor: CatalogActor, command: unknown): Promise<ShiftCatalogReceipt> {
  assertAdmin(actor);
  const input = insertShiftTableSchema.parse(command);
  const requestDigest = digest({ action: "save", input });
  return database.transaction(async tx => {
    // Same transaction lock as attendance/payroll input mutation; no linked rows are rewritten.
    await tx.execute(sql`select pg_advisory_xact_lock(73612849)`);
    const prior = await replay(tx, actor, input.requestId, requestDigest);
    if (prior) return prior;
    const before = input.id ? await loadDefinition(tx, input.id) : null;
    if (input.id) assertCurrent(before, input.expectedVersion);
    const effective = insertShiftTableSchema.parse({
      ...input,
      calculationPolicy: input.calculationPolicy ?? before?.calculationPolicy ?? "legacy",
      punchPolicy: input.punchPolicy ?? before?.punchPolicy ?? "legacy",
      breaks: input.breaks.map(row => ({ ...row, requiresPunches: row.requiresPunches ?? (
        row.fromTime && row.toTime ? before?.breaks.find(old => old.slotKey === row.slotKey)?.requiresPunches ?? false : false
      ) })),
    });
    const [duplicate] = await tx.select({ id: shiftTables.id }).from(shiftTables)
      .where(and(eq(shiftTables.code, effective.code), isNull(shiftTables.archivedAt)));
    if (duplicate && duplicate.id !== before?.id) throw new Error(`An active schedule with code ${effective.code} already exists.`);
    let previousVersionAfter: Definition | undefined;
    if (before) {
      await tx.update(shiftTables).set({ archivedAt: new Date() }).where(eq(shiftTables.id, before.id));
      previousVersionAfter = (await loadDefinition(tx, before.id))!;
    }
    const [created] = await tx.insert(shiftTables).values({
      code: effective.code, description: effective.description,
      regularStartTime: effective.regularStartTime, regularEndTime: effective.regularEndTime,
      calculationPolicy: effective.calculationPolicy, punchPolicy: effective.punchPolicy,
      ...(before ? { familyId: before.familyId, version: before.version + 1 } : {}),
    }).returning();
    const breaks = effective.breaks.flatMap((row, index) => row.fromTime && row.toTime ? [{
      shiftTableId: created.id, slotKey: row.slotKey, label: SHIFT_BREAK_SLOT_DEFINITIONS[index].label,
      sortOrder: SHIFT_BREAK_SLOT_DEFINITIONS[index].sortOrder,
      fromTime: row.fromTime, toTime: row.toTime, deduct: row.deduct,
      deductHours: row.deduct ? row.deductHours : 0, deductMinutes: row.deduct ? row.deductMinutes : 0,
      requiresPunches: row.requiresPunches ?? false,
    }] : []);
    if (breaks.length) await tx.insert(shiftTableBreaks).values(breaks);
    const after = (await loadDefinition(tx, created.id))!;
    const receipt: ShiftCatalogReceipt = {
      requestId: input.requestId, action: before ? "revised" : "created", shiftTableId: created.id,
      familyId: created.familyId, version: created.version, archivedAt: null,
      message: before ? `Schedule version ${created.version} saved. Existing assignments keep their saved version.` : "Schedule created. Select it in Schedules to assign it to employees.",
    };
    await recordResult(tx, actor, requestDigest, receipt, before, after, previousVersionAfter);
    return receipt;
  });
}

export async function archiveShiftCatalog(database: DbClient, actor: CatalogActor, command: unknown): Promise<ShiftCatalogReceipt> {
  assertAdmin(actor);
  const input = deleteShiftTableSchema.parse(command);
  const requestDigest = digest({ action: "archive", input });
  return database.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(73612849)`);
    const prior = await replay(tx, actor, input.requestId, requestDigest);
    if (prior) return prior;
    const before = await loadDefinition(tx, input.id);
    assertCurrent(before, input.expectedVersion);
    const archivedAt = new Date();
    await tx.update(shiftTables).set({ archivedAt }).where(eq(shiftTables.id, input.id));
    const after = (await loadDefinition(tx, input.id))!;
    const receipt: ShiftCatalogReceipt = {
      requestId: input.requestId, action: "archived", shiftTableId: before.id,
      familyId: before.familyId, version: before.version, archivedAt: archivedAt.toISOString(),
      message: "Schedule archived. Existing assignments and history are preserved.",
    };
    await recordResult(tx, actor, requestDigest, receipt, before, after);
    return receipt;
  });
}
