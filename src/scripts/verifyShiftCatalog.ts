import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { archiveShiftCatalog, readShiftCatalog, saveShiftCatalog } from "@/lib/scheduling/shift-catalog";
import { buildShiftBreakRows } from "@/lib/shifts";

/** Fictional, in-memory SQL only: no environment configuration, server, or private backup. */
async function main() {
  const pg = new PGlite();
  const database = drizzle(pg, { schema });
  const client = database as unknown as DbClient;
  const actor = { userId: "fictional-admin", role: "ADMIN" };
  let checks = 0;
  try {
    await pg.exec(`CREATE TABLE employee_shift_assignments (id serial PRIMARY KEY, fixture text NOT NULL);
      CREATE TABLE attendance_daily_summaries (id serial PRIMARY KEY, fixture text NOT NULL);
      CREATE TABLE admin_audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id varchar(255) NOT NULL,
        entity_type varchar(80) NOT NULL, entity_id varchar(255), action varchar(120) NOT NULL, details text,
        created_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE manager_schedule_change_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL, payload jsonb NOT NULL);`);
    // The real original catalog migration verifies both historical unique declarations are removed.
    await pg.exec(await readFile("src/db/migrations/0063_faithful_frank_castle.sql", "utf8"));
    await pg.exec(`CREATE TABLE employee_weekly_shift_pattern_days (id serial PRIMARY KEY, fixture text NOT NULL,
      shift_table_id integer REFERENCES shift_tables(id) ON DELETE SET NULL);
      INSERT INTO shift_tables(code,description,regular_start_time,regular_end_time) VALUES ('OLD','SPLIT fictional original','08:00','21:00');
      INSERT INTO shift_table_breaks(shift_table_id,slot_key,label,from_time,to_time,deduct,deduct_hours,deduct_minutes,sort_order)
        VALUES (1,'mid_break','Original gap','12:00','16:30',true,4,30,1);
      INSERT INTO employee_shift_assignments(fixture,shift_table_id) VALUES ('dated history',1);
      INSERT INTO employee_weekly_shift_pattern_days(fixture,shift_table_id) VALUES ('weekly history',1);
      INSERT INTO attendance_daily_summaries(fixture) VALUES ('summary history');
      INSERT INTO manager_schedule_change_requests(status,payload) VALUES ('Pending','{"shiftTableId":1}'),('Approved','{"shiftTableId":1}');`);
    const old = (await pg.query("select * from shift_tables where id=1")).rows[0];
    const oldBreak = (await pg.query("select * from shift_table_breaks where id=1")).rows[0];
    await pg.exec(await readFile("src/db/migrations/0127_shift_catalog_versions.sql", "utf8"));
    const migrated = (await pg.query<Record<string, unknown>>("select * from shift_tables where id=1")).rows[0];
    assert.deepEqual(Object.fromEntries(Object.keys(old!).map(key => [key, migrated[key]])), old);
    assert.equal(migrated.version, 1); assert.equal(migrated.calculation_policy, "legacy");
    assert.equal(migrated.punch_policy, "legacy"); assert.equal(migrated.archived_at, null);
    assert.ok(migrated.family_id);
    const migratedBreak = (await pg.query<Record<string, unknown>>("select * from shift_table_breaks where id=1")).rows[0];
    assert.deepEqual(Object.fromEntries(Object.keys(oldBreak!).map(key => [key, migratedBreak[key]])), oldBreak);
    assert.equal(migratedBreak.requires_punches, false);
    const weekly = (await pg.query<Record<string, unknown>>("select * from employee_weekly_shift_pattern_days")).rows[0];
    assert.equal(weekly.definition_snapshot, null); assert.equal(weekly.calculation_policy, "legacy");
    assert.equal(weekly.punch_policy, "legacy");
    assert.equal((await pg.query<{ calculation_policy: string }>("select * from attendance_daily_summaries")).rows[0].calculation_policy, "legacy");
    checks++;

    const protectedRows = async () => JSON.stringify((await pg.query(`select json_build_object(
      'dated',(select json_agg(t) from employee_shift_assignments t),
      'weekly',(select json_agg(t) from employee_weekly_shift_pattern_days t),
      'summaries',(select json_agg(t) from attendance_daily_summaries t),
      'requests',(select json_agg(t) from manager_schedule_change_requests t)) as data`)).rows);
    const baseline = await protectedRows();
    const input = {
      requestId: randomUUID(), code: "NEW", description: "Fictional 8.5 hours", regularStartTime: "08:00", regularEndTime: "21:00",
      calculationPolicy: "eight_hour_day" as const, punchPolicy: "split_gaps" as const,
      breaks: buildShiftBreakRows([{ slotKey: "mid_break", fromTime: "11:00", toTime: "15:30", deduct: true, deductHours: 4, deductMinutes: 30, requiresPunches: true }]),
    };
    const created = await saveShiftCatalog(client, actor, input);
    assert.equal(created.action, "created"); assert.equal(created.version, 1);
    assert.notEqual(created.familyId, migrated.family_id);
    assert.equal(await protectedRows(), baseline); checks++;
    const counts = async () => (await pg.query(`select (select count(*) from shift_tables) as definitions,
      (select count(*) from admin_audit_events) as audits, (select count(*) from shift_catalog_receipts) as receipts`)).rows;
    const createdCounts = await counts();
    assert.deepEqual(await saveShiftCatalog(client, actor, input), created);
    assert.deepEqual(await counts(), createdCounts);
    await assert.rejects(saveShiftCatalog(client, actor, { ...input, description: "Changed request" }), /already used/);
    await assert.rejects(saveShiftCatalog(client, { ...actor, userId: "another-admin" }, input), /already used/);
    await assert.rejects(saveShiftCatalog(client, { ...actor, role: "MANAGER" }, input), /Forbidden/);
    await assert.rejects(saveShiftCatalog(client, actor, { ...input, requestId: undefined }));
    await assert.rejects(saveShiftCatalog(client, actor, { ...input, requestId: randomUUID(), id: 1 }));
    await assert.rejects(saveShiftCatalog(client, actor, { ...input, requestId: randomUUID(), regularStartTime: "25:00" }));
    assert.deepEqual(await counts(), createdCounts); checks++;

    const oldDefinition = (await readShiftCatalog(client, { includeArchived: true, includeUsage: true })).find(row => row.id === 1)!;
    assert.deepEqual(oldDefinition.usage, { weeklyDays: 1, datedAssignments: 1, pendingRequests: 1 });
    const revisionInput = { ...input, requestId: randomUUID(), id: 1, expectedVersion: 1, code: "OLD" };
    const revised = await saveShiftCatalog(client, actor, revisionInput);
    assert.equal(revised.action, "revised"); assert.equal(revised.version, 2);
    assert.equal(revised.familyId, migrated.family_id); assert.notEqual(revised.shiftTableId, 1);
    const previous = (await database.select().from(schema.shiftTables).where(eq(schema.shiftTables.id, 1)))[0];
    assert.ok(previous.archivedAt); assert.equal(previous.description, "SPLIT fictional original");
    assert.equal(previous.calculationPolicy, "legacy"); assert.equal(previous.punchPolicy, "legacy");
    assert.deepEqual((await pg.query("select * from shift_table_breaks where id=1")).rows[0], migratedBreak);
    assert.equal(await protectedRows(), baseline);
    assert.equal((await readShiftCatalog(client)).some(row => row.id === 1), false);
    const all = await readShiftCatalog(client, { includeArchived: true, includeUsage: true });
    assert.equal(all.length, 3); assert.ok(all.find(row => row.id === 1)?.archivedAt);
    assert.deepEqual(all.find(row => row.id === 1)?.usage, { weeklyDays: 1, datedAssignments: 1, pendingRequests: 1 });
    assert.deepEqual(all.find(row => row.id === revised.shiftTableId)?.usage, { weeklyDays: 0, datedAssignments: 0, pendingRequests: 0 });
    assert.equal((await readShiftCatalog(client))[0].usage, undefined); checks++;
    assert.deepEqual(await saveShiftCatalog(client, actor, revisionInput), revised);
    await assert.rejects(saveShiftCatalog(client, actor, { ...revisionInput, requestId: randomUUID() }), /changed or was archived/);
    await assert.rejects(archiveShiftCatalog(client, actor, { requestId: randomUUID(), id: revised.shiftTableId, expectedVersion: 1 }), /changed or was archived/);
    const preserveInput = {
      ...input, id: revised.shiftTableId, expectedVersion: 2, code: "OLD", requestId: randomUUID(),
      calculationPolicy: undefined, punchPolicy: undefined,
      breaks: input.breaks.map(row => ({ ...row, requiresPunches: undefined })),
    };
    const preserved = await saveShiftCatalog(client, actor, preserveInput);
    const preservedRow = (await readShiftCatalog(client)).find(row => row.id === preserved.shiftTableId)!;
    assert.equal(preservedRow.calculationPolicy, "eight_hour_day"); assert.equal(preservedRow.punchPolicy, "split_gaps");
    assert.equal(preservedRow.breaks[0].requiresPunches, true); checks++;
    // Explicitly retaining the policy still preserves omitted old gap flags.
    const flagPreserving = await saveShiftCatalog(client, actor, { ...preserveInput,
      id: preserved.shiftTableId, expectedVersion: 3, requestId: randomUUID(), punchPolicy: "split_gaps" });
    assert.equal((await readShiftCatalog(client)).find(row => row.id === flagPreserving.shiftTableId)?.breaks[0].requiresPunches, true);
    const current = flagPreserving;

    const beforeFailure = await counts();
    await assert.rejects(saveShiftCatalog(client, actor, { ...input, id: current.shiftTableId, expectedVersion: 4, requestId: randomUUID() }), /already exists/);
    assert.equal((await readShiftCatalog(client)).find(row => row.id === current.shiftTableId)?.archivedAt, null);
    assert.deepEqual(await counts(), beforeFailure);
    // A failure after insertion must undo archive, new definition, break rows and receipt too.
    await pg.exec(`CREATE FUNCTION fixture_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit unavailable'; END $$;
      CREATE TRIGGER reject_fixture_audit BEFORE INSERT ON admin_audit_events FOR EACH ROW EXECUTE FUNCTION fixture_reject_audit();`);
    await assert.rejects(saveShiftCatalog(client, actor, { ...preserveInput, id: current.shiftTableId, expectedVersion: 4, requestId: randomUUID() }));
    assert.deepEqual(await counts(), beforeFailure);
    assert.equal((await readShiftCatalog(client)).find(row => row.id === current.shiftTableId)?.archivedAt, null);
    await pg.exec("DROP TRIGGER reject_fixture_audit ON admin_audit_events;"); checks++;

    const archiveInput = { requestId: randomUUID(), id: current.shiftTableId, expectedVersion: 4 };
    const archived = await archiveShiftCatalog(client, actor, archiveInput);
    assert.equal(archived.action, "archived"); assert.ok(archived.archivedAt);
    const afterArchiveCounts = await counts();
    assert.deepEqual(await archiveShiftCatalog(client, actor, archiveInput), archived);
    assert.deepEqual(await counts(), afterArchiveCounts);
    assert.equal((await readShiftCatalog(client)).some(row => row.id === current.shiftTableId), false);
    assert.equal((await readShiftCatalog(client, { includeArchived: true })).some(row => row.id === current.shiftTableId), true);
    await assert.rejects(archiveShiftCatalog(client, actor, { ...archiveInput, requestId: randomUUID() }), /changed or was archived/);
    const audit = await database.select().from(schema.adminAuditEvents);
    const revisionAudit = JSON.parse(audit.find(row => row.entityId === String(revised.shiftTableId))!.details!);
    assert.equal(revisionAudit.before.breaks[0].fromTime, "12:00:00");
    assert.equal(revisionAudit.after.breaks[0].fromTime, "11:00:00");
    assert.ok(revisionAudit.previousVersionAfter.archivedAt);
    assert.equal(await protectedRows(), baseline); checks++;

    await assert.rejects(pg.exec(`INSERT INTO shift_tables(code,description,regular_start_time,regular_end_time,version) VALUES ('INVALID','invalid','08:00','17:00',0)`));
    await assert.rejects(pg.exec(`INSERT INTO shift_tables(code,description,regular_start_time,regular_end_time,calculation_policy) VALUES ('INVALID','invalid','08:00','17:00','other')`));
    await assert.rejects(pg.exec(`INSERT INTO shift_tables(code,description,regular_start_time,regular_end_time) VALUES ('NEW','duplicate','08:00','17:00')`));
    await assert.rejects(pg.exec(`INSERT INTO shift_tables(code,description,regular_start_time,regular_end_time,family_id,version) SELECT 'DUPLICATE','invalid','08:00','17:00',family_id,2 FROM shift_tables WHERE id=1`));
    await assert.rejects(pg.exec(`INSERT INTO shift_tables(code,description,regular_start_time,regular_end_time,family_id,version) SELECT 'DUPLICATE','invalid','08:00','17:00',family_id,99 FROM shift_tables WHERE code='NEW' AND archived_at IS NULL`));
    await assert.rejects(archiveShiftCatalog(client, actor, { id: created.shiftTableId }));
    checks++;

    // New writes cannot reintroduce a second calculation rule or guess split punches.
    const legacyInput = { ...input, requestId: randomUUID(), code: "LEGACY-OMITTED", calculationPolicy: undefined,
      punchPolicy: undefined, breaks: input.breaks.map(row => ({ ...row, requiresPunches: undefined })) };
    const beforeInvalidPolicy = await counts();
    await assert.rejects(saveShiftCatalog(client, actor, legacyInput), /explicit punch policy/);
    await assert.rejects(saveShiftCatalog(client, actor, { ...input, requestId: randomUUID(), code: "OLD-RULE", calculationPolicy: "legacy" }), /eight-hour normal-pay rule/);
    for (const punchPolicy of ["legacy", undefined]) {
      await assert.rejects(saveShiftCatalog(client, actor, { ...legacyInput, requestId: randomUUID(), code: "INVALID-POLICY",
        calculationPolicy: "eight_hour_day", punchPolicy }), /explicit punch policy/);
    }
    assert.deepEqual(await counts(), beforeInvalidPolicy);
    const standard = await saveShiftCatalog(client, actor, { ...input, requestId: randomUUID(), code: "ONE-RULE", calculationPolicy: undefined });
    assert.equal((await readShiftCatalog(client)).find(row => row.id === standard.shiftTableId)?.calculationPolicy, "eight_hour_day");
    assert.equal(await protectedRows(), baseline); checks++;
    console.log(JSON.stringify({ passed: true, groups: checks, migration: "0127_shift_catalog_versions", fixture: "fresh in-memory PGlite; fictional data only" }));
  } finally {
    await pg.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
