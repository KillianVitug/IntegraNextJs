import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import * as s from "@/db/schema";
import { buildShiftBreakRows } from "@/lib/shifts";
import { saveShiftCatalog } from "@/lib/scheduling/shift-catalog";
import { confirmScopedScheduleDays, readScheduleWorkspace } from "@/lib/scheduling/service";
import { loadProvisionalPayroll } from "@/lib/payroll/provisional";
import { workEmployees } from "@/lib/payroll/attendanceWorkbench";
import { persistAdminDecision } from "@/lib/payroll/attendanceAdminDecisionStore";
import { loadEffectiveAttendanceInputSet } from "@/lib/payroll/effectiveAttendanceInputs";
import { resolutionPeople } from "@/lib/payroll/attendanceResolution";
import type { SourcePunch } from "@/lib/payroll/attendanceSourceClient";
import type { WorkDraft, WorkRecord } from "@/lib/payroll/attendanceWorkbenchModel";
import type { AttendanceCorrectionPayload, AttendanceCorrectionPunch } from "@/lib/payroll/attendanceCorrections";
import { freshScheduleDatabase } from "./attendanceTest/freshScheduleDatabase";

// The release comparator executes this exact fixture on baseline and candidate.
// Only new finding assertions are skipped on baseline; all pay/source checks run.
const baseline = process.env.PROVISIONAL_FINANCIAL_BASELINE === "1";
async function main() {
 const { pg, database, client, transactional } = await freshScheduleDatabase();
 const actor = { userId: randomUUID(), role: "ADMIN" as const };
 const days = ["2020-10-16", "2020-10-17", "2020-10-18", "2020-10-19", "2020-10-20"];
 const checks: string[] = [], financialProjection: unknown[] = [];
 try {
  const [branch] = await database.insert(s.department).values({ code: "FINDINGS-QA", name: "Fictional findings branch" }).returning();
  const [employee] = await database.insert(s.employees).values({ employeeNo: "FINDINGS-QA", firstName: "Fictional", lastName: "Findings" }).returning();
  await database.insert(s.employeesGeneralInfo).values({ employeeId: employee.id, departmentId: branch.id, dateHired: days[0], payrollTerms: "Semi-Monthly" });
  await database.insert(s.employeesSalary).values({ employeeId: employee.id, dailyRate: "800", monthlyRate: "0", ignoreContributionDeduction: true });
  await database.insert(s.accountCode).values([
   { accountCode: "REG", accountType: "Regular Hours", description: "Regular hours", dailyRate: "1", monthlyRate: "1" },
   { accountCode: "OT", accountType: "Overtime", description: "Overtime", dailyRate: "1.25", monthlyRate: "1.25" },
   { accountCode: "LATE", accountType: "Unpaid Leaves/Absences", description: "Tardiness" },
   { accountCode: "LWOP", accountType: "Unpaid Leaves/Absences", description: "Leave Without Pay" },
  ]);
  const [period] = await database.insert(s.payrollPeriods).values({ code: "2020-10-B", year: 2020, month: 10, cycle: "B", payrollTerms: "Semi-Monthly", startDate: days[0], endDate: days[4], nominalPayDate: "2020-10-31", adjustedPayDate: "2020-10-31", status: "Open" }).returning();
  const regular = await saveShiftCatalog(client, actor, { requestId: randomUUID(), code: "FINDINGS-REG", description: "Fictional regular", regularStartTime: "08:00", regularEndTime: "17:00", calculationPolicy: "eight_hour_day", punchPolicy: "outer", breaks: buildShiftBreakRows([{ slotKey: "mid_break", fromTime: "12:00", toTime: "13:00", deduct: true, deductHours: 1, deductMinutes: 0, requiresPunches: false }]) });
  const split = await saveShiftCatalog(client, actor, { requestId: randomUUID(), code: "FINDINGS-SPLIT", description: "Fictional split", regularStartTime: "08:00", regularEndTime: "21:00", calculationPolicy: "eight_hour_day", punchPolicy: "split_gaps", breaks: buildShiftBreakRows([{ slotKey: "mid_break", fromTime: "11:00", toTime: "15:30", deduct: true, deductHours: 4, deductMinutes: 30, requiresPunches: true }]) });
  const workspace = await readScheduleWorkspace(actor, { departmentId: branch.id, periodId: period.id, effectiveDate: days[0] }, client);
  await confirmScopedScheduleDays(actor, { requestId: randomUUID(), departmentId: branch.id, periodId: period.id, sourceDigest: workspace.sourceDigest, expectedDraftId: null, expectedDraftRevision: null, changes: days.map(day => ({ employeeId: employee.id, day, value: String(day === days[4] ? split.shiftTableId : regular.shiftTableId) })) }, transactional);
  const sourceId = "FINDINGS-SOURCE";
  await database.insert(s.attendanceSourceMappings).values({ sourceEmployeeId: sourceId, employeeId: employee.id, actorUserId: "fixture", reason: "Fictional mapping" });
  const punch = (day: string, time: string, type: "IN" | "OUT"): SourcePunch => ({ eventId: randomUUID(), employeeId: sourceId, employeeName: "Fictional", originalEmployeeId: sourceId, originalEmployeeName: "Fictional", branchId: "QA", type, capturedAt: `${day}T${time}:00+08:00`, receivedAt: `${day}T${time}:00+08:00`, updatedAt: `${day}T${time}:00+08:00`, status: "VALID", clockFlag: false, reviewResolved: false, reviewFlags: [] });
  const source = [punch(days[0], "08:00", "IN"), punch(days[0], "09:00", "IN"), punch(days[0], "10:00", "IN"), punch(days[0], "17:00", "OUT"), punch(days[3], "08:00", "IN"), punch(days[3], "17:00", "OUT")];
  source[1].reviewFlags=["CONSECUTIVE_IN"];
  async function storeSources(records: SourcePunch[]) {
   await database.insert(s.attendanceSourceEvents).values(records.map(payload => ({ eventId: payload.eventId, sourceEmployeeId: sourceId, capturedAt: new Date(payload.capturedAt), payload, firstPayload: payload })));
   await database.insert(s.attendanceSourceProjections).values(records.map(record => ({ payrollPeriodId: period.id, eventId: record.eventId, employeeId: employee.id, rawLogId: null, payloadHash: "fictional" })));
  }
  await storeSources(source);
  const asWork = (p: SourcePunch): WorkRecord => ({ id: p.eventId, source: "API", employeeId: employee.id, type: p.type, at: p.capturedAt, status: p.status, clockFlag: p.clockFlag, clockVerified: p.clockVerified, sourcePunch:p });
  async function decide(day: string, original: WorkRecord[], records: WorkRecord[]) {
   const draft: WorkDraft = { employeeId: employee.id, days: [day], changes: [], reason: "Fictional verified decision", ownerId: "fixture", needed: "", rejected: false, version: "fixture" };
   const [batch] = await database.insert(s.workBatches).values({ periodId: period.id, actor: "fixture" }).returning();
   const [plan] = await database.insert(s.workPlans).values({ batchId: batch.id, periodId: period.id, employeeId: employee.id, draft, state: "Resolved", evidenceVersion: "fixture", ownerId: "fixture" }).returning();
   await persistAdminDecision(client, { periodId: period.id, planId: plan.id, actor: "fixture", employeeNo: employee.employeeNo, draft, sourceRecords: original, records, warnings: [] });
  }
  const originals = source.slice(0, 4).map(asWork);
  await decide(days[0], originals, originals.map((row, index) => index === 1 || index === 2 ? { ...row, status: "VOID" } : row));
  await decide(days[3], source.slice(4).map(asWork), []);
  const [fileBatch] = await database.insert(s.attendanceImportBatches).values({ payrollPeriodId: period.id, sourceFileName: "fictional-findings.csv", sourceFormat: "CSV", status: "Processed" }).returning();
  const fileRows = await database.insert(s.attendanceRawLogs).values([
   { day: days[1], time: "08:00", direction: "IN" as const },
   { day: days[2], time: "08:00", direction: "IN" as const },
   { day: days[2], time: "08:01", direction: "IN" as const },
   { day: days[2], time: "17:00", direction: "OUT" as const },
   { day: days[4], time: "08:00", direction: "IN" as const },
   { day: days[4], time: "21:00", direction: "OUT" as const },
  ].map(row => ({ batchId: fileBatch.id, employeeId: employee.id, employeeNo: employee.employeeNo, logDate: row.day, logTime: row.time, loggedAt: new Date(`${row.day}T${row.time}:00Z`), direction: row.direction }))).returning();
  const synthetic: AttendanceCorrectionPunch = { rawLogId: null, employeeId: employee.id, employeeNo: employee.employeeNo, logDate: days[1], logTime: "17:00:00", loggedAt: `${days[1]}T17:00:00Z`, direction: "OUT", sourceLine: 0, rawText: "Fictional approved OUT", deviceId: null, siteCode: null, synthetic: true };
  const payload = (ignoredRawLogIds: number[], syntheticPunches: AttendanceCorrectionPunch[]): AttendanceCorrectionPayload => ({ ignoredRawLogIds, syntheticPunches, rawPunches: [], effectivePunches: [], proposedMetrics: null });
  await database.insert(s.attendanceDtrCorrections).values([
   { payrollPeriodId: period.id, employeeId: employee.id, attendanceDate: days[1], correctionType: "Missing Out", status: "Approved", reason: "Fictional reviewed OUT", payload: payload([], [synthetic]) },
   { payrollPeriodId: period.id, employeeId: employee.id, attendanceDate: days[2], correctionType: "Duplicate Punch", status: "Approved", reason: "Fictional duplicate", payload: payload([fileRows[2].id], []) },
  ]);
  async function fingerprint() {
   const tables = (await pg.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
   const hash = createHash("sha256");
   for (const { tablename } of tables) hash.update(tablename).update(JSON.stringify((await pg.query(`select to_jsonb(t) as row from "${tablename.replaceAll('"', '""')}" t order by to_jsonb(t)::text`)).rows));
   return hash.digest("hex");
  }
  async function read(label: string) {
   const before = await fingerprint();
   const result = await loadProvisionalPayroll({ periodId: period.id, employeeId: employee.id, group: "Daily", asOfDate: days[4] }, transactional);
   const [board] = await workEmployees(period.id, client, undefined, "2020-10-21T12:00:00+08:00", employee.id);
   assert.equal(await fingerprint(), before, "Both read paths preserve every stored table");
   const person = result.rows[0]; assert(person.recorded, person.warnings.join(" | "));
   const amounts = (lines: typeof person.recordedLines) => lines.map(({ code, lineType, amount, quantity, rate }) => ({ code, lineType, amount, quantity, rate }));
   financialProjection.push({ label, recorded: person.recorded, forecast: person.forecast, recordedLines: amounts(person.recordedLines), forecastLines: amounts(person.forecastLines), days: person.days.map(({ date, scheduledMinutes, workedMinutes, regularMinutes, firstIn, lastOut }) => ({ date, scheduledMinutes, workedMinutes, regularMinutes, firstIn, lastOut })) });
   return { person, board, day: (date: string) => person.days.find(row => row.date === date)!, workday: (date: string) => board.days.find(row => row.day === date)! };
  }
  const fixed = await read("reviewed-corrections");
  assert.equal(fixed.day(days[0]).regularMinutes, 480); assert.equal(fixed.day(days[1]).regularMinutes, 480); assert.equal(fixed.day(days[2]).regularMinutes, 480); assert.equal(fixed.day(days[3]).regularMinutes, 0);
  const rawInput = await loadEffectiveAttendanceInputSet(client, { payrollPeriodId: period.id, employeeIds: [employee.id], startDate: days[1], endDate: days[1] });
  assert.equal(rawInput.logs.length, 1, "Finding overlay never injects a synthetic OUT into payroll raw input");
  if (!baseline) {
   for (const day of days.slice(0, 4)) { assert.deepEqual(fixed.day(day).attendance!.issues, [], `${day}: corrected/approved facts are not open findings`); assert.deepEqual(fixed.workday(day).attendance, fixed.day(day).attendance, "Batch/provisional attendance contract agrees"); assert.deepEqual(fixed.workday(day).issues, []); }
   assert.equal(fixed.day(days[0]).attendance!.punches.filter(p => p.evidenceState === "resolved").length, 2, "Both voided originals remain visible");
   assert.equal(fixed.day(days[1]).attendance!.complete, true); assert.equal(fixed.day(days[2]).attendance!.punches.filter(p => p.evidenceState === "resolved").length, 1);
   for(const day of days){const punches=fixed.day(day).attendance!.punches;assert.equal(new Set(punches.map(p=>p.id)).size,punches.length,"Displayed corrected/source keys remain unique");}
   assert.equal(fixed.day(days[3]).attendance!.complete, false, "Approved no work never fabricates a payable pair");
   assert.equal(fixed.day(days[3]).review?.reviewedNoWork,true,"Only the approved empty workday is reviewed no work");
   assert.equal(fixed.day(days[0]).review?.reviewedNoWork,false,"An approved completed workday is not a no-work decision");
   assert(fixed.day(days[4]).attendance!.issues.some(issue => issue.includes("split-break"))); assert(fixed.workday(days[4]).issues.some(issue => issue.includes("split-break")));
  }
  checks.push("Local void/approved absence and older synthetic/duplicate corrections preserve original facts and pay; audit captures are informational; split gaps remain actionable");
  const incoming = punch(days[0], "18:00", "IN"); await storeSources([incoming]);
  const changed = await read("new-incoming-evidence");
  assert.deepEqual(changed.person.recorded, fixed.person.recorded, "New conflicting source never replaces approved pay input");
  if (!baseline) { assert.equal(changed.day(days[0]).attendance!.lateConflict, true); assert.equal(changed.day(days[0]).attendance!.canConfirmExisting, false); assert(changed.workday(days[0]).issues.some(issue => /differs/.test(issue))); assert.equal(changed.workday(days[0]).resolved, false); }
  await database.delete(s.attendanceSourceProjections).where(eq(s.attendanceSourceProjections.eventId, incoming.eventId)); await database.delete(s.attendanceSourceEvents).where(eq(s.attendanceSourceEvents.eventId, incoming.eventId));
  checks.push("Actually new source evidence reopens attention without changing approved payroll attendance");
  for(const change of [{clockFlag:true},{reviewFlags:["IDENTITY_CONFLICT"]}]){
   await database.update(s.attendanceSourceEvents).set({payload:{...source[0],...change}}).where(eq(s.attendanceSourceEvents.eventId,source[0].eventId));
   const warned=await read("clockFlag" in change?"new-clock-warning":"new-identity-warning");
   assert.deepEqual(warned.person.recorded,fixed.person.recorded,"Source metadata never rewrites approved input");
   if(!baseline){assert.equal(warned.day(days[0]).attendance!.lateConflict,true);assert(warned.day(days[0]).attendance!.issues.some(issue=>/clock|investigation/.test(issue)));assert.equal(warned.workday(days[0]).resolved,false);}
  }
  await database.update(s.attendanceSourceEvents).set({payload:source[0]}).where(eq(s.attendanceSourceEvents.eventId,source[0].eventId));
  checks.push("New clock/identity warnings remain actionable even when the financial evidence digest is unchanged; unchanged reviewed flags stay historical");
  await database.insert(s.attendanceSourceIdentities).values({sourceEmployeeId:sourceId,classification:"TestOnly",actorUserId:"fixture",reason:"Fictional classification change"});
  const reclassified=await read("identity-reclassified");
  assert.deepEqual(reclassified.person.recorded,fixed.person.recorded,"Identity reclassification preserves approved payable input");
  if(!baseline){assert(reclassified.day(days[0]).attendance!.issues.some(issue=>/test-only/.test(issue)));assert.equal(reclassified.workday(days[0]).resolved,false);}
  await database.delete(s.attendanceSourceIdentities).where(eq(s.attendanceSourceIdentities.sourceEmployeeId,sourceId));
  const [hold] = await database.insert(s.employeeAttendanceDayStatusOverrides).values({ payrollPeriodId: period.id, employeeId: employee.id, attendanceDate: days[0], status: "Hold", remarks: "Fictional independent hold" }).returning();
  const held = await read("independent-hold"); assert.equal(held.day(days[0]).payrollHold, true);
  if (!baseline) { assert(held.workday(days[0]).issues.some(issue => issue.includes("on hold"))); assert.equal(held.workday(days[0]).resolved, false); }
  await database.delete(s.employeeAttendanceDayStatusOverrides).where(eq(s.employeeAttendanceDayStatusOverrides.id, hold.id));
  checks.push("A separate Hold remains actionable after attendance correction");
  // The approval covers the punches, not all future versions of the schedule.
  const changedWorkspace = await readScheduleWorkspace(actor, { departmentId: branch.id, periodId: period.id, effectiveDate: days[0] }, client);
  await confirmScopedScheduleDays(actor, { requestId: randomUUID(), departmentId: branch.id, periodId: period.id, sourceDigest: changedWorkspace.sourceDigest, expectedDraftId: null, expectedDraftRevision: null, changes: [{ employeeId: employee.id, day: days[0], value: String(split.shiftTableId) }] }, transactional);
  const scheduleChanged = await read("schedule-requires-extra-pair");
  if (!baseline) { assert(scheduleChanged.day(days[0]).attendance!.issues.some(issue => issue.includes("split-break"))); assert(scheduleChanged.workday(days[0]).issues.some(issue => issue.includes("split-break"))); assert.equal(scheduleChanged.workday(days[0]).resolved, false); }
  checks.push("An approved decision cannot suppress a new required split-gap finding");
  const overnight = await saveShiftCatalog(client, actor, { requestId: randomUUID(), code: "FINDINGS-NIGHT", description: "Fictional overnight split", regularStartTime: "20:00", regularEndTime: "07:00", calculationPolicy: "eight_hour_day", punchPolicy: "split_gaps", breaks: buildShiftBreakRows([{ slotKey: "mid_break", fromTime: "00:00", toTime: "03:00", deduct: true, deductHours: 3, deductMinutes: 0, requiresPunches: true }]) });
  await database.delete(s.attendanceRawLogs).where(inArray(s.attendanceRawLogs.id, fileRows.slice(4).map(row=>row.id)));
  await database.insert(s.attendanceRawLogs).values(["20:00","00:00","03:00","07:00"].map((time,index)=>({batchId:fileBatch.id,employeeId:employee.id,employeeNo:employee.employeeNo,logDate:index?"2020-10-21":days[4],logTime:time,loggedAt:new Date(`${index?"2020-10-21":days[4]}T${time}:00Z`),direction:index%2?"OUT" as const:"IN" as const})));
  const nightWorkspace = await readScheduleWorkspace(actor, { departmentId: branch.id, periodId: period.id, effectiveDate: days[4] }, client);
  await confirmScopedScheduleDays(actor, { requestId: randomUUID(), departmentId: branch.id, periodId: period.id, sourceDigest: nightWorkspace.sourceDigest, expectedDraftId: null, expectedDraftRevision: null, changes: [{ employeeId: employee.id, day: days[4], value: String(overnight.shiftTableId) }] }, transactional);
  const night = await read("completed-overnight-split");
  assert.equal(night.day(days[4]).regularMinutes,480,"Civil-date split attendance remains eight normal hours");
  if(!baseline){assert.equal(night.day(days[4]).attendance!.complete,true);assert.deepEqual(night.day(days[4]).attendance!.issues,[]);assert.deepEqual(night.workday(days[4]).issues,[]);assert.equal(night.day(days[4]).attendance!.punches.filter(p=>p.included).length,4);}
  checks.push("A complete overnight split retains its scheduled workday across midnight and period end, with no false required-pair finding");
  const [legacy] = await database.insert(s.attendanceResolutions).values({payrollPeriodId:period.id,sourceEmployeeId:sourceId,employeeId:employee.id,kind:"NoAttendance",state:"Approved",sourceVersion:"deliberately-stale",reason:"Fictional old approval",evidence:"Fictional",actorUserId:"fixture"}).returning();
  const staleLegacy=await read("stale-legacy-no-attendance");
  if(!baseline)assert.equal(staleLegacy.day(days[1]).review?.reviewedNoWork,false,"An expired legacy resolution cannot suppress current attention");
  // The real legacy approval flow requires all this identity's punches VOID.
  for(const record of source)await database.update(s.attendanceSourceEvents).set({payload:{...record,status:"VOID"}}).where(eq(s.attendanceSourceEvents.eventId,record.eventId));
  const [resolutionPerson]=await resolutionPeople(client,{id:period.id,startDate:period.startDate,endDate:period.endDate});
  await database.update(s.attendanceResolutions).set({sourceVersion:resolutionPerson.version}).where(eq(s.attendanceResolutions.id,legacy.id));
  const validLegacy=await read("verified-legacy-no-attendance");
  if(!baseline)assert.equal(validLegacy.day(days[1]).review?.reviewedNoWork,true,"Only a current, valid legacy resolution supplies reviewed no-work metadata");
  checks.push("Reviewed-no-work metadata requires the exact approved workday or a current verified legacy resolution; stale legacy approval cannot suppress findings");
  const secondSourceId="FINDINGS-SECOND-SOURCE",secondCapture={...punch(days[1],"09:00","IN"),employeeId:secondSourceId,originalEmployeeId:secondSourceId,status:"VOID" as const};
  await database.insert(s.attendanceSourceMappings).values({sourceEmployeeId:secondSourceId,employeeId:employee.id,actorUserId:"fixture",reason:"Second fictional source for the same employee"});
  await database.insert(s.attendanceSourceEvents).values({eventId:secondCapture.eventId,sourceEmployeeId:secondSourceId,capturedAt:new Date(secondCapture.capturedAt),payload:secondCapture,firstPayload:secondCapture});
  await database.insert(s.attendanceSourceProjections).values({payrollPeriodId:period.id,eventId:secondCapture.eventId,employeeId:employee.id,rawLogId:null,payloadHash:"fictional-second-source"});
  const unreviewedSecondSource=await read("second-source-without-no-attendance-approval");
  if(!baseline)assert.equal(unreviewedSecondSource.day(days[1]).review?.reviewedNoWork,false,"One source's approval cannot suppress attention for another source mapped to the same employee");
  const secondPerson=(await resolutionPeople(client,{id:period.id,startDate:period.startDate,endDate:period.endDate})).find(person=>person.sourceId===secondSourceId)!;
  await database.insert(s.attendanceResolutions).values({payrollPeriodId:period.id,sourceEmployeeId:secondSourceId,employeeId:employee.id,kind:"NoAttendance",state:"Approved",sourceVersion:secondPerson.version,reason:"Fictional reviewed second source",evidence:"Fictional",actorUserId:"fixture"});
  const allSourcesReviewed=await read("every-source-has-current-no-attendance-approval");
  if(!baseline)assert.equal(allSourcesReviewed.day(days[1]).review?.reviewedNoWork,true,"All current source groups must independently have a valid approved no-attendance decision");
  checks.push("Employee-wide legacy no-attendance requires every current in-period mapped source group to have its own valid approval");
  console.log(JSON.stringify({ passed: true, baseline, checks, financialProjection, fixture: "Fresh fictional PGlite/current schema only; every read fingerprints all tables; no production, migration/FK or browser acceptance" }));
 } finally { await pg.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
