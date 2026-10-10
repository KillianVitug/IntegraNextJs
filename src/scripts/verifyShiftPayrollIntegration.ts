import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { buildShiftBreakRows } from "@/lib/shifts";
import { saveShiftCatalog } from "@/lib/scheduling/shift-catalog";
import { confirmScopedScheduleDays, readScheduleWorkspace } from "@/lib/scheduling/service";
import { loadProvisionalPayroll } from "@/lib/payroll/provisional";
import { computeManualPayrollLatestBaseline, loadPayrollCalculation } from "@/lib/payroll/engine";
import { refreshSchedulePayrollDerivatives } from "@/lib/payroll/scheduleRefresh";
import { monthRange } from "@/lib/payroll/payrollGroupModel";
import { freshScheduleDatabase } from "./attendanceTest/freshScheduleDatabase";
import { saveManualPayrollEntrySchema } from "@/zod-schemas/manualPayroll";
import type * as manualServices from "@/lib/payroll/manualPayroll";
import type * as overtimeServices from "@/lib/payroll/overtimeOverrides";

// These older services have a module-owned db rather than a client argument.
// Rebind only that storage boundary; every financial/mutation function is the
// actual source. The payrollGroups dependency needs the same database binding.
function fixtureServices(database: ReturnType<typeof freshScheduleDatabase> extends Promise<infer T> ? T extends { transactional: infer D } ? D : never : never) {
  const cache = new Map<string, object>();
  const load = (name: "manualPayroll" | "overtimeOverrides" | "payrollGroups"): object => {
    if (cache.has(name)) return cache.get(name)!;
    const filename = path.resolve(`src/lib/payroll/${name}.ts`), nativeRequire = createRequire(filename);
    const fixtureModule = { exports: {} }; cache.set(name, fixtureModule.exports);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const require = (request: string) => request === "@/db" ? { db: database } : request === "./payrollGroups" ? load("payrollGroups") : nativeRequire(request);
    new vm.Script(compiled, { filename }).runInNewContext({ module: fixtureModule, exports: fixtureModule.exports, require, Date, Map, Set, Promise, Buffer, console, process });
    return fixtureModule.exports;
  };
  return { manual: load("manualPayroll") as typeof manualServices, overtime: load("overtimeOverrides") as typeof overtimeServices };
}

/** Fictional current-schema storage only. No URL, restored data, actual run
 * generation/approval, or production connection. Contributions are explicitly disabled
 * on fixture salaries: this acceptance isolates normal/OT and Monthly base pay. */
async function main() {
  const { pg, database, client, transactional } = await freshScheduleDatabase();
  const actor = { userId: randomUUID(), role: "ADMIN" as const };
  const day = "2020-10-16";
  const checks: string[] = [];
  try {
    const [branch] = await database.insert(s.department).values({ code: "SHIFT-FICTION", name: "Fictional payroll branch" }).returning();
    const [daily, monthly] = await database.insert(s.employees).values(["DAILY", "MONTHLY"].map(code => ({ employeeNo: `SHIFT-${code}`, firstName: "Fictional", lastName: code }))).returning();
    await database.insert(s.employeesGeneralInfo).values([daily, monthly].map(person => ({ employeeId: person.id, departmentId: branch.id, dateHired: day, payrollTerms: "Semi-Monthly" as const })));
    await database.insert(s.employeesSalary).values([
      { employeeId: daily.id, dailyRate: "800", monthlyRate: "0", ignoreContributionDeduction: true },
      { employeeId: monthly.id, dailyRate: "0", monthlyRate: "30000", ignoreContributionDeduction: true },
    ]);
    await database.insert(s.accountCode).values([
      { accountCode: "REG", accountType: "Regular Hours", description: "Regular hours", dailyRate: "1", monthlyRate: "1" },
      // Deliberately differs from the OT rule: explicit policy must use the rule.
      { accountCode: "OT", accountType: "Overtime", description: "Regular overtime", dailyRate: "9", monthlyRate: "9" },
      { accountCode: "LATE", accountType: "Unpaid Leaves/Absences", description: "Tardiness" },
      { accountCode: "LWOP", accountType: "Unpaid Leaves/Absences", description: "Leave Without Pay" },
    ]);
    await database.insert(s.overtimeRules).values({ category: "REGULAR_DAY", minutesFrom: 1, minutesTo: null, rateMultiplier: "1.25" });
    const [period] = await database.insert(s.payrollPeriods).values({ code: "2020-10-B", year: 2020, month: 10, cycle: "B", payrollTerms: "Semi-Monthly", startDate: day, endDate: day, nominalPayDate: "2020-10-31", adjustedPayDate: "2020-10-31", status: "Open" }).returning();
    const shift = await saveShiftCatalog(client, actor, { requestId: randomUUID(), code: "SHIFT-PAY-FIX", description: "Fictional split payroll", regularStartTime: "08:00", regularEndTime: "21:00", calculationPolicy: "eight_hour_day", punchPolicy: "split_gaps", breaks: buildShiftBreakRows([{ slotKey: "mid_break", fromTime: "11:00", toTime: "15:30", deduct: true, deductHours: 4, deductMinutes: 30, requiresPunches: true }]) });
    const [batch] = await database.insert(s.attendanceImportBatches).values({ sourceFileName: "fictional-shift-pay.csv", sourceFormat: "CSV", payrollPeriodId: period.id, status: "Processed" }).returning();
    await database.insert(s.attendanceRawLogs).values([daily, monthly].flatMap(person => ["08:00", "11:00", "15:30", "21:00"].map((time, index) => ({ batchId: batch.id, employeeId: person.id, employeeNo: person.employeeNo, logDate: day, logTime: time, loggedAt: new Date(`${day}T${time}:00Z`), direction: index % 2 ? "OUT" as const : "IN" as const }))));
    const workspace = await readScheduleWorkspace(actor, { departmentId: branch.id, periodId: period.id, effectiveDate: day }, client);
    await confirmScopedScheduleDays(actor, { requestId: randomUUID(), departmentId: branch.id, periodId: period.id, sourceDigest: workspace.sourceDigest, expectedDraftId: null, expectedDraftRevision: null, changes: [daily, monthly].map(person => ({ employeeId: person.id, day, value: String(shift.shiftTableId) })) }, transactional);
    const dailySummary = (await database.select().from(s.attendanceDailySummaries).where(eq(s.attendanceDailySummaries.employeeId, daily.id)))[0];
    assert.equal(dailySummary.regularMinutes, 480);
    assert.equal(dailySummary.overtimeMinutes, 30);
    const estimate = (group: "Daily" | "Monthly", employeeId: string) => loadProvisionalPayroll({ periodId: period.id, group, employeeId, asOfDate: day }, transactional);
    const official = async (group: "Daily" | "Monthly", employeeId: string) => (await (await loadPayrollCalculation(group === "Monthly" ? { ...period, ...monthRange(period) } : period, group, client, { employeeId })).calculate()).computations[0];
    const state = async () => ({ runs: await database.select().from(s.payrollRuns), logs: await database.select().from(s.attendanceRawLogs), summaries: await database.select().from(s.attendanceDailySummaries), exceptions: await database.select().from(s.employeePayrollExceptionRows), manual: await database.select().from(s.manualPayrollEntries), manualLines: await database.select().from(s.manualPayrollEntryLines) });
    const beforeUnapproved = await state();
    const unapprovedEstimate = (await estimate("Daily", daily.id)).rows[0];
    assert.equal(unapprovedEstimate.status, "Available", unapprovedEstimate.warnings.join(" | "));
    assert.equal(unapprovedEstimate.recorded?.gross, 800);
    assert.equal((await official("Daily", daily.id)).grossPay, 800);
    const unapprovedBaseline = await computeManualPayrollLatestBaseline(period.id, daily.id, client);
    assert.ok(unapprovedBaseline);
    assert.equal(unapprovedBaseline.lines.filter(line => line.lineType === "Earning").reduce((sum, line) => sum + Number(line.amount), 0), 800);
    assert.deepEqual(await state(), beforeUnapproved, "All three read paths preserve persisted evidence and create no run");
    checks.push("Raw captures → confirmed explicit definition → persisted480 normal/30 detected; provisional, official calculator and manual baseline pay800 before approval");
    await database.insert(s.employeeDailyOvertimeOverrides).values([daily, monthly].map(person => ({ employeeId: person.id, attendanceDate: day, isApproved: true, category: "REGULAR_DAY" as const })));
    // Exercise the actual shared derivative refresh inside this fictional store.
    await database.transaction(async tx => { for (const person of [daily, monthly]) await refreshSchedulePayrollDerivatives({ tx: tx as unknown as typeof client, actorUserId: actor.userId, employeeId: person.id, startDate: day, endDate: day }); });
    const beforeApproved = await state();
    const approvedEstimate = (await estimate("Daily", daily.id)).rows[0];
    const approvedOfficial = await official("Daily", daily.id);
    const approvedBaseline = await computeManualPayrollLatestBaseline(period.id, daily.id, client);
    assert.equal(approvedEstimate.recorded?.gross, 862.5);
    assert.equal(approvedOfficial.grossPay, 862.5);
    assert.ok(approvedBaseline);
    assert.equal(approvedBaseline.lines.filter(line => line.lineType === "Earning").reduce((sum, line) => sum + Number(line.amount), 0), 862.5);
    assert.equal(approvedOfficial.lines.find(line => line.code === "OT")?.amount, 62.5, "30min uses800/8×0.5×1.25 despite account multiplier9");
    assert.equal(approvedOfficial.totalDeductions, 0);
    assert.equal(approvedEstimate.recorded?.net, 862.5);
    assert.deepEqual(await state(), beforeApproved);
    checks.push("Approved30min pays62.50 by OT rule; all three read paths agree on862.50 and persist no changes");
    const monthlyEstimate = (await estimate("Monthly", monthly.id)).rows[0];
    const monthlyOfficial = await official("Monthly", monthly.id);
    const monthlyBaseline = await computeManualPayrollLatestBaseline(period.id, monthly.id, client);
    assert.equal(monthlyEstimate.recorded?.gross, 30000);
    assert.equal(monthlyOfficial.grossPay, 30000);
    assert.ok(monthlyBaseline);
    assert.equal(monthlyBaseline.lines.filter(line => line.lineType === "Earning").reduce((sum, line) => sum + Number(line.amount), 0), 30000);
    assert.deepEqual(await state(), beforeApproved);
    assert.equal((await database.select().from(s.payrollRuns)).length, 0);
    checks.push("Monthly fixed30000 remains unchanged across provisional, official calculator and manual baseline despite explicit attendance/approved OT");
    const services = fixtureServices(transactional);
    const explicitLine = (code: string, amount: number) => ({ code, amount, lineType: "Earning", summaryBucket: "otherIncome", description: "Fictional explicit adjustment", sourceTable: null, sourceId: null });
    for (const [person, baseline, addition] of [[daily, approvedBaseline, 250], [monthly, monthlyBaseline, 123]] as const) {
      await services.manual.saveManualPayrollEntry({ actorUserId: actor.userId, latestBaseline: baseline, payload: saveManualPayrollEntrySchema.parse({ ...baseline.fields, employeeId: person.id, payrollPeriodId: period.id, lines: [...baseline.lines.map(line => ({ ...line, id: undefined })), explicitLine(`EXPLICIT-${person.employeeNo}`, addition)] }) });
    }
    const monthlyEntryBefore = (await database.select().from(s.manualPayrollEntries).where(eq(s.manualPayrollEntries.employeeId, monthly.id)))[0];
    const monthlyLinesBefore = await database.select().from(s.manualPayrollEntryLines).where(eq(s.manualPayrollEntryLines.manualPayrollEntryId, monthlyEntryBefore.id));
    assert.equal(Number(monthlyEntryBefore.grossPay), 30123);
    const [reviewed] = await database.insert(s.payrollRuns).values({ payrollPeriodId: period.id, runNumber: 1, status: "Reviewed", inputSnapshot: { payrollGroup: "Daily" } }).returning();
    await database.insert(s.payrollRunEmployees).values({ payrollRunId: reviewed.id, employeeId: daily.id, employeeNoSnapshot: daily.employeeNo, employeeNameSnapshot: "Fictional Daily" });
    const changeApproval = (isApproved: boolean) => services.overtime.saveEmployeePayrollOvertimeOverride({ actorUserId: actor.userId, payrollPeriodId: period.id, employeeId: daily.id, attendanceDate: day, isApproved, category: "REGULAR_DAY", manualHours: 0, manualMinutes: 0 });
    await changeApproval(false);
    assert.equal((await database.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, reviewed.id)))[0].status, "Stale");
    let dailyEntry = (await database.select().from(s.manualPayrollEntries).where(eq(s.manualPayrollEntries.employeeId, daily.id)))[0];
    assert.equal(Number(dailyEntry.grossPay), 1050, "Revoking OT refreshes existing manual attendance lines while retaining explicit250");
    await database.update(s.payrollRuns).set({ status: "Reviewed" }).where(eq(s.payrollRuns.id, reviewed.id));
    await changeApproval(true);
    assert.equal((await database.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, reviewed.id)))[0].status, "Stale");
    dailyEntry = (await database.select().from(s.manualPayrollEntries).where(eq(s.manualPayrollEntries.employeeId, daily.id)))[0];
    assert.equal(Number(dailyEntry.grossPay), 1112.5, "Reapproval refreshes actual saved manual OT to62.50");
    const dailyLines = await database.select().from(s.manualPayrollEntryLines).where(eq(s.manualPayrollEntryLines.manualPayrollEntryId, dailyEntry.id));
    assert.equal(Number(dailyLines.find(line => line.code === "OT")?.amount), 62.5);
    assert.equal(Number(dailyLines.find(line => line.code.startsWith("EXPLICIT-"))?.amount), 250);
    await database.transaction(async tx => { await refreshSchedulePayrollDerivatives({ tx: tx as unknown as typeof client, actorUserId: actor.userId, employeeId: monthly.id, startDate: day, endDate: day }); });
    assert.deepEqual((await database.select().from(s.manualPayrollEntries).where(eq(s.manualPayrollEntries.employeeId, monthly.id)))[0], monthlyEntryBefore);
    assert.deepEqual(await database.select().from(s.manualPayrollEntryLines).where(eq(s.manualPayrollEntryLines.manualPayrollEntryId, monthlyEntryBefore.id)), monthlyLinesBefore);
    assert.equal((await database.select().from(s.payrollRuns)).length, 1, "Only the deliberately seeded fictional Reviewed/Stale sentinel exists");
    checks.push("Actual manual-save and OT-revoke/reapprove services: Reviewed→Stale precedes derivative refresh; saved Daily changes1112.50→1050→1112.50 while retaining explicit250; Monthly manual30123 unchanged");
    console.log(JSON.stringify({ passed: true, checks, fixture: "fresh fictional PGlite/current schema; two old service modules use only a rebound database import", limits: "No statutory deduction rules or official run approval/posting tested; no GUI/auth flow; current-schema fixture omits migration/FK compatibility, covered separately" }));
  } finally { await pg.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
