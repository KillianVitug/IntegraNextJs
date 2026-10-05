import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { DbClient } from "@/db";
import { attendanceSourceEvents } from "@/db/attendanceSourceSchema";
import { attendanceMatchingInbox } from "@/lib/payroll/attendanceMatchingInbox";
import { matchesSearch, matchHint, suggestedEmployees, verificationReason, type AttendancePerson } from "@/lib/payroll/attendanceMatching";

async function main() {
  const person: AttendancePerson = { sourceId: "404", names: ["Santos, María"], branches: ["North"], punchCount: 1, validCount: 1, lastCapturedAt: "2026-09-01T00:00:00Z" };
  const sameName = { id: "a", employeeNo: "00404", name: "Maria Santos" };
  const sameCode = { id: "b", employeeNo: "404", name: "Different Person" };
  const unrelated = { id: "c", employeeNo: "999", name: "Another Person" };
  assert.deepEqual(suggestedEmployees(person, [unrelated, sameCode, sameName]).map(item => item.employee.id), ["a", "b"], "Ambiguous IDs must remain separate choices; name is stronger than number alone");
  assert.match(matchHint(person, sameCode)!, /Check the name carefully/);
  assert.equal(matchHint({ ...person, sourceId: "9007199254740992", names: ["Unknown"] }, { ...sameCode, employeeNo: "9007199254740993" }), null, "Large numeric IDs must not collide through number conversion");
  assert.deepEqual(suggestedEmployees({ ...person, sourceId: "unknown", names: ["Unknown"] }, [sameName]), []);
  assert.ok(matchesSearch("santos MARIA", sameName.name, sameName.employeeNo));
  assert.ok(matchesSearch("404 north", person.sourceId, ...person.branches));
  assert.equal(verificationReason("other", "  "), null);
  assert.equal(verificationReason("invented", "note"), null);
  assert.equal(verificationReason("supervisor", "  Checked with supervisor on October 5.  "), "Confirmed with the branch supervisor. Checked with supervisor on October 5.");
  assert.equal(verificationReason("roster", ""), "Checked HR's employee record.");

  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE attendance_source_events (event_id uuid PRIMARY KEY, source_employee_id text NOT NULL, captured_at timestamptz NOT NULL, payload jsonb NOT NULL, first_payload jsonb NOT NULL, revision integer DEFAULT 1, seen_at timestamptz DEFAULT now())");
    const database = drizzle(pg);
    const event = (id: string, name: string, branch: string, date: string, status = "VALID") => ({ eventId: randomUUID(), sourceEmployeeId: id, capturedAt: new Date(date), payload: { employeeName: name, branchId: branch, status }, firstPayload: {} });
    await database.insert(attendanceSourceEvents).values([
      event("old-unmatched", "Older Person", "North", "2026-09-01T00:00:00Z", "VOID"),
      event("404", "Santos, Maria", "North", "2026-09-02T00:00:00Z"),
      event("404", "Maria Santos", "South", "2026-10-05T00:00:00Z", "VOID"),
      ...Array.from({ length: 501 }, () => event("busy-employee", "Recent Person", "Central", "2026-10-05T01:00:00Z")),
    ]);
    const inbox = await attendanceMatchingInbox(database as unknown as DbClient);
    assert.equal(inbox.length, 3, "The person list is not limited to the latest 500 punches");
    assert.deepEqual(inbox.find(item => item.sourceId === "old-unmatched"), { sourceId: "old-unmatched", names: ["Older Person"], branches: ["North"], punchCount: 1, validCount: 0, lastCapturedAt: "2026-09-01T00:00:00.000Z" }, "Void-only identities remain reviewable");
    assert.deepEqual(inbox.find(item => item.sourceId === "404"), { sourceId: "404", names: ["Maria Santos", "Santos, Maria"], branches: ["North", "South"], punchCount: 2, validCount: 1, lastCapturedAt: "2026-10-05T00:00:00.000Z" }, "Name variants and branches are retained for identity review");
  } finally { await pg.close(); }
  console.log("Attendance matching checks passed: ambiguous suggestions, ID precision, evidence, all-period inbox, older and void-only identities.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
