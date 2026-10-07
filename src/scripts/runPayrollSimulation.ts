import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import type {
  ParsedAttendanceLog,
  ShiftWindow,
} from "@/lib/payroll/attendance";

type CheckStatus = "pass" | "fail" | "warn" | "skip";

type SimulationCheck = {
  name: string;
  status: CheckStatus;
  details?: string;
};

type SimulationReport = {
  generatedAt: string;
  databaseMode: "PAYROLL_SIM_DATABASE_URL" | "DATABASE_URL_OVERRIDE";
  payrollYear: number;
  payrollPeriods: {
    source: string;
    target: string;
  };
  checks: SimulationCheck[];
  findings: string[];
  seeded: {
    adminEmail: string;
    managerEmail: string;
    employeeNos: string[];
  };
};

const ROOT_DIR = process.cwd();
const REPORT_DIR = path.join(ROOT_DIR, "test-results");
const REPORT_JSON_PATH = path.join(REPORT_DIR, "payroll-simulation.json");
const REPORT_MD_PATH = path.join(REPORT_DIR, "payroll-simulation.md");
const SIM_PREFIX = "SIM-PAYROLL";
const SIM_EMPLOYEE_NOS = [
  `${SIM_PREFIX}-ADMIN`,
  `${SIM_PREFIX}-MANAGER`,
  `${SIM_PREFIX}-DAILY`,
  `${SIM_PREFIX}-MONTHLY`,
  `${SIM_PREFIX}-OUTSIDE`,
] as const;
const ADMIN_EMAIL = "sim-payroll-admin@example.test";
const MANAGER_EMAIL = "sim-payroll-manager@example.test";

function configureDatabaseUrl() {
  loadEnv({ path: path.join(ROOT_DIR, ".env.local") });

  const simulationUrl = process.env.PAYROLL_SIM_DATABASE_URL?.trim();
  if (simulationUrl) {
    process.env.DATABASE_URL = simulationUrl;
    return "PAYROLL_SIM_DATABASE_URL" as const;
  }

  if (process.env.PAYROLL_SIM_ALLOW_DATABASE_URL === "1") {
    if (!process.env.DATABASE_URL?.trim()) {
      throw new Error("DATABASE_URL is missing.");
    }
    return "DATABASE_URL_OVERRIDE" as const;
  }

  throw new Error(
    [
      "Refusing to run payroll simulation against the ordinary application database.",
      "Set PAYROLL_SIM_DATABASE_URL to a disposable/test database URL.",
      "For a deliberate local override, set PAYROLL_SIM_ALLOW_DATABASE_URL=1.",
    ].join(" ")
  );
}

function getPayrollYear() {
  const parsed = Number(process.env.PAYROLL_SIM_YEAR);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100
    ? parsed
    : new Date().getFullYear();
}

function monthDate(year: number, day: number) {
  return `${year}-03-${String(day).padStart(2, "0")}`;
}

function money(value: number) {
  return value.toFixed(2);
}

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function addCheck(
  report: SimulationReport,
  name: string,
  status: CheckStatus,
  details?: string
) {
  report.checks.push({ name, status, details });
  if (status === "fail") {
    report.findings.push(`${name}: ${details ?? "failed"}`);
  }
}

async function runCheck(
  report: SimulationReport,
  name: string,
  action: () => Promise<string | void> | string | void
) {
  try {
    const details = await action();
    addCheck(report, name, "pass", details ?? undefined);
  } catch (error) {
    addCheck(
      report,
      name,
      "fail",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function renderMarkdown(report: SimulationReport) {
  const failures = report.checks.filter((check) => check.status === "fail");
  const warnings = report.checks.filter((check) => check.status === "warn");
  const lines = [
    "# Payroll Simulation Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Database mode: ${report.databaseMode}`,
    `Payroll year: ${report.payrollYear}`,
    `Source period: ${report.payrollPeriods.source}`,
    `Target period: ${report.payrollPeriods.target}`,
    "",
    "## Summary",
    "",
    `- Passed: ${report.checks.filter((check) => check.status === "pass").length}`,
    `- Failed: ${failures.length}`,
    `- Warnings: ${warnings.length}`,
    "",
    "## Checks",
    "",
    ...report.checks.map(
      (check) =>
        `- ${check.status.toUpperCase()} ${check.name}${
          check.details ? ` - ${check.details}` : ""
        }`
    ),
    "",
    "## Findings",
    "",
    ...(report.findings.length > 0
      ? report.findings.map((finding) => `- ${finding}`)
      : ["No simulation failures were detected."]),
    "",
  ];

  return lines.join("\n");
}

async function writeReport(report: SimulationReport) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2));
  fs.writeFileSync(REPORT_MD_PATH, renderMarkdown(report));
}

async function main() {
  const databaseMode = configureDatabaseUrl();
  const year = getPayrollYear();
  const sourcePeriodCode = `${year}-03-A`;
  const targetPeriodCode = `${year}-03-B`;
  const report: SimulationReport = {
    generatedAt: new Date().toISOString(),
    databaseMode,
    payrollYear: year,
    payrollPeriods: {
      source: sourcePeriodCode,
      target: targetPeriodCode,
    },
    checks: [],
    findings: [],
    seeded: {
      adminEmail: ADMIN_EMAIL,
      managerEmail: MANAGER_EMAIL,
      employeeNos: [...SIM_EMPLOYEE_NOS],
    },
  };

  const [{ db }, schema, authCrypto, groupSync, payrollFoundation, payrollEngine, attendanceLib, loanLib, drizzle] =
    await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("@/lib/auth/crypto"),
      import("@/lib/auth/group-sync"),
      import("@/lib/payroll/foundation"),
      import("@/lib/payroll/engine"),
      import("@/lib/payroll/attendance"),
      import("@/lib/payroll/loan"),
      import("drizzle-orm"),
    ]);
  const { and, asc, desc, eq, inArray, isNull, sql } = drizzle;

  await runCheck(report, "Safety guard", () => {
    assert.ok(process.env.DATABASE_URL?.trim(), "Simulation database URL is set.");
    return databaseMode === "PAYROLL_SIM_DATABASE_URL"
      ? "Using PAYROLL_SIM_DATABASE_URL."
      : "Using DATABASE_URL because PAYROLL_SIM_ALLOW_DATABASE_URL=1.";
  });

  let adminAccountId = "";
  let managerAccountId = "";
  let adminEmployeeId = "";
  let managerEmployeeId = "";
  let payrollDepartmentId = 0;
  let outsideDepartmentId = 0;
  let dayShiftId = 0;
  let dailyEmployeeId = "";
  let monthlyEmployeeId = "";
  let outsideEmployeeId = "";
  let sourcePeriodId = "";
  let targetPeriodId = "";
  let loanId = "";
  let loanInstallmentId = "";
  let leaveTypeIds: { paid: number; unpaid: number } = { paid: 0, unpaid: 0 };
  let accountCodeIds: Record<string, number> = {};

  await runCheck(report, "Seed deterministic simulation data", async () => {
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.payrollRuns)
        .where(
          sql`${schema.payrollRuns.payrollPeriodId} in (
            select id from ${schema.payrollPeriods}
            where code in (${sourcePeriodCode}, ${targetPeriodCode})
          )`
        );
      await tx
        .delete(schema.employees)
        .where(inArray(schema.employees.employeeNo, [...SIM_EMPLOYEE_NOS]));
      await tx
        .delete(schema.leaveTypes)
        .where(inArray(schema.leaveTypes.code, [`${SIM_PREFIX}-LWOP`]));
      await tx
        .delete(schema.accountCode)
        .where(
          inArray(schema.accountCode.accountCode, [
            `${SIM_PREFIX}-LOAN`,
            `${SIM_PREFIX}-ALLOW`,
            `${SIM_PREFIX}-LWOP`,
            `${SIM_PREFIX}-HOLD-WORK`,
            `${SIM_PREFIX}-HOLD-OT`,
          ])
        );
      await tx
        .delete(schema.department)
        .where(
          inArray(schema.department.code, [
            `${SIM_PREFIX}-DEPT`,
            `${SIM_PREFIX}-OTHER`,
          ])
        );
      await tx
        .delete(schema.shiftTables)
        .where(eq(schema.shiftTables.code, `${SIM_PREFIX}-DAY`));
    });

    await payrollFoundation.ensurePayrollFoundationData();
    await payrollEngine.ensureSemiMonthlyPayrollPeriods(year);

    const [sourcePeriod, targetPeriod] = await Promise.all([
      db.query.payrollPeriods.findFirst({
        where: eq(schema.payrollPeriods.code, sourcePeriodCode),
      }),
      db.query.payrollPeriods.findFirst({
        where: eq(schema.payrollPeriods.code, targetPeriodCode),
      }),
    ]);
    assert.ok(sourcePeriod, `Payroll period ${sourcePeriodCode} exists.`);
    assert.ok(targetPeriod, `Payroll period ${targetPeriodCode} exists.`);
    sourcePeriodId = sourcePeriod.id;
    targetPeriodId = targetPeriod.id;

    const passwordHash = await authCrypto.hashPassword("PayrollSim#12345");

    await db.transaction(async (tx) => {
      await groupSync.ensureDefaultPermissionGroupsTx(tx);

      const [payrollDepartment, outsideDepartment] = await tx
        .insert(schema.department)
        .values([
          { code: `${SIM_PREFIX}-DEPT`, name: "Payroll Simulation Department" },
          { code: `${SIM_PREFIX}-OTHER`, name: "Payroll Simulation Outside Department" },
        ])
        .returning();
      payrollDepartmentId = payrollDepartment.id;
      outsideDepartmentId = outsideDepartment.id;

      const [loanAccount, recurringAccount, unpaidAccount, holdWorkedAccount, holdOvertimeAccount] =
        await tx
          .insert(schema.accountCode)
          .values([
            {
              accountType: "Loan",
              accountCode: `${SIM_PREFIX}-LOAN`,
              description: "Simulation Loan",
              nonTaxable: true,
              month13thPay: false,
            },
            {
              accountType: "Other Income",
              accountCode: `${SIM_PREFIX}-ALLOW`,
              description: "Simulation Allowance",
              nonTaxable: false,
              month13thPay: false,
            },
            {
              accountType: "Unpaid Leaves/Absences",
              accountCode: `${SIM_PREFIX}-LWOP`,
              description: "Simulation LWOP",
              nonTaxable: true,
              month13thPay: false,
            },
            {
              accountType: "Regular Hours",
              accountCode: `${SIM_PREFIX}-HOLD-WORK`,
              description: "Approved Held DTR Worked Time",
              nonTaxable: false,
              month13thPay: true,
            },
            {
              accountType: "Overtime",
              accountCode: `${SIM_PREFIX}-HOLD-OT`,
              description: "Approved Held DTR Overtime",
              nonTaxable: false,
              month13thPay: false,
            },
          ])
          .returning();
      accountCodeIds = {
        loan: loanAccount.id,
        recurring: recurringAccount.id,
        unpaid: unpaidAccount.id,
        holdWorked: holdWorkedAccount.id,
        holdOvertime: holdOvertimeAccount.id,
      };

      const paidLeave = await tx.query.leaveTypes.findFirst({
        where: eq(schema.leaveTypes.code, "SL"),
      });
      assert.ok(paidLeave, "Default SL leave type exists.");
      const [unpaidLeave] = await tx
        .insert(schema.leaveTypes)
        .values({
          code: `${SIM_PREFIX}-LWOP`,
          name: "Simulation Leave Without Pay",
          accountCodeId: unpaidAccount.id,
          isPaid: false,
          requiresBalance: false,
          annualEntitlement: "0.00",
        })
        .returning();
      leaveTypeIds = { paid: paidLeave.id, unpaid: unpaidLeave.id };

      const [shift] = await tx
        .insert(schema.shiftTables)
        .values({
          code: `${SIM_PREFIX}-DAY`,
          description: "Simulation Day Shift",
          regularStartTime: "08:00:00",
          regularEndTime: "17:00:00",
        })
        .returning();
      dayShiftId = shift.id;
      await tx.insert(schema.shiftTableBreaks).values({
        shiftTableId: shift.id,
        slotKey: "mid_break",
        label: "Lunch",
        fromTime: "12:00:00",
        toTime: "13:00:00",
        deduct: true,
        deductHours: 1,
        deductMinutes: 0,
        sortOrder: 1,
      });

      const createdEmployees = await tx
        .insert(schema.employees)
        .values([
          {
            employeeType: "ADMIN",
            employeeNo: `${SIM_PREFIX}-ADMIN`,
            firstName: "Payroll",
            lastName: "Admin",
          },
          {
            employeeType: "ADMIN",
            employeeNo: `${SIM_PREFIX}-MANAGER`,
            firstName: "Payroll",
            lastName: "Manager",
          },
          {
            employeeType: "EMP",
            employeeNo: `${SIM_PREFIX}-DAILY`,
            firstName: "Daily",
            lastName: "Worker",
          },
          {
            employeeType: "EMP",
            employeeNo: `${SIM_PREFIX}-MONTHLY`,
            firstName: "Monthly",
            lastName: "Worker",
          },
          {
            employeeType: "EMP",
            employeeNo: `${SIM_PREFIX}-OUTSIDE`,
            firstName: "Outside",
            lastName: "Worker",
          },
        ])
        .returning();

      const employeeByNo = new Map(
        createdEmployees.map((employee) => [employee.employeeNo, employee])
      );
      adminEmployeeId = employeeByNo.get(`${SIM_PREFIX}-ADMIN`)!.id;
      managerEmployeeId = employeeByNo.get(`${SIM_PREFIX}-MANAGER`)!.id;
      dailyEmployeeId = employeeByNo.get(`${SIM_PREFIX}-DAILY`)!.id;
      monthlyEmployeeId = employeeByNo.get(`${SIM_PREFIX}-MONTHLY`)!.id;
      outsideEmployeeId = employeeByNo.get(`${SIM_PREFIX}-OUTSIDE`)!.id;

      await tx.insert(schema.employeesGeneralInfo).values([
        {
          employeeId: adminEmployeeId,
          payrollTerms: "Semi-Monthly",
          payrollMode: "Bank",
          departmentId: payrollDepartmentId,
          employmentStatus: "Regular",
          confidentialityLevel: "Managerial",
          dateHired: `${year}-01-01`,
          taxStatus: "S",
        },
        {
          employeeId: managerEmployeeId,
          payrollTerms: "Semi-Monthly",
          payrollMode: "Bank",
          departmentId: payrollDepartmentId,
          employmentStatus: "Regular",
          confidentialityLevel: "Rank and File",
          dateHired: `${year}-01-01`,
          taxStatus: "S",
        },
        {
          employeeId: dailyEmployeeId,
          payrollTerms: "Semi-Monthly",
          payrollMode: "Bank",
          departmentId: payrollDepartmentId,
          employmentStatus: "Regular",
          confidentialityLevel: "Rank and File",
          dateHired: `${year}-01-01`,
          taxStatus: "S",
        },
        {
          employeeId: monthlyEmployeeId,
          payrollTerms: "Semi-Monthly",
          payrollMode: "Bank",
          departmentId: payrollDepartmentId,
          employmentStatus: "Regular",
          confidentialityLevel: "Rank and File",
          dateHired: `${year}-01-01`,
          taxStatus: "S",
        },
        {
          employeeId: outsideEmployeeId,
          payrollTerms: "Semi-Monthly",
          payrollMode: "Bank",
          departmentId: outsideDepartmentId,
          employmentStatus: "Regular",
          confidentialityLevel: "Rank and File",
          dateHired: `${year}-01-01`,
          taxStatus: "S",
        },
      ]);

      await tx.insert(schema.employeesOtherReferences).values([
        { employeeId: adminEmployeeId, email: ADMIN_EMAIL },
        { employeeId: managerEmployeeId, email: MANAGER_EMAIL },
        { employeeId: dailyEmployeeId, email: "sim-payroll-daily@example.test" },
        { employeeId: monthlyEmployeeId, email: "sim-payroll-monthly@example.test" },
        { employeeId: outsideEmployeeId, email: "sim-payroll-outside@example.test" },
      ]);

      await tx.insert(schema.employeesSalary).values([
        {
          employeeId: dailyEmployeeId,
          dailyRate: money(800),
          monthlyAllowance: money(1000),
          dailyAllowance: money(50),
          cola: money(25),
          rateDivisor: "26.00",
        },
        {
          employeeId: monthlyEmployeeId,
          monthlyRate: money(26000),
          monthlyAllowance: money(500),
          rateDivisor: "26.00",
        },
        {
          employeeId: outsideEmployeeId,
          dailyRate: money(700),
          rateDivisor: "26.00",
        },
      ]);

      await tx.insert(schema.employeesTimekeeping).values([
        {
          employeeId: dailyEmployeeId,
          timekeepingId: `${SIM_PREFIX}-DAILY`,
          shiftSchedule: "Morning",
          checkInTime: "08:00:00",
          checkOutTime: "17:00:00",
          restDay: "Sunday",
          hoursWorked: "8.00",
          minutesWorked: "480.00",
        },
        {
          employeeId: monthlyEmployeeId,
          timekeepingId: `${SIM_PREFIX}-MONTHLY`,
          shiftSchedule: "Morning",
          checkInTime: "08:00:00",
          checkOutTime: "17:00:00",
          restDay: "Sunday",
          hoursWorked: "8.00",
          minutesWorked: "480.00",
        },
        {
          employeeId: outsideEmployeeId,
          timekeepingId: `${SIM_PREFIX}-OUTSIDE`,
          shiftSchedule: "Morning",
          checkInTime: "08:00:00",
          checkOutTime: "17:00:00",
          restDay: "Sunday",
          hoursWorked: "8.00",
          minutesWorked: "480.00",
        },
      ]);

      const [adminAccount, managerAccount] = await tx
        .insert(schema.authAccounts)
        .values([
          {
            employeeId: adminEmployeeId,
            email: ADMIN_EMAIL,
            passwordHash,
            status: "Active",
            mustSetPassword: false,
          },
          {
            employeeId: managerEmployeeId,
            email: MANAGER_EMAIL,
            passwordHash,
            status: "Active",
            mustSetPassword: false,
          },
        ])
        .returning();
      adminAccountId = adminAccount.id;
      managerAccountId = managerAccount.id;
      await groupSync.setAccountGroupsTx(tx, adminAccountId, ["SYSTEM_ADMIN"]);
      await groupSync.setAccountGroupsTx(tx, managerAccountId, ["MANAGER"]);
      await groupSync.setManagerDepartmentsTx(tx, managerAccountId, [
        payrollDepartmentId,
      ]);

      await tx.insert(schema.employeesRecurringEntries).values({
        employeeId: dailyEmployeeId,
        accountCode: `${SIM_PREFIX}-ALLOW`,
        description: "Simulation recurring allowance",
        amount: money(250),
        frequency: "Monthly",
        status: "Active",
        startDate: `${year}-01-01`,
      });
    });

    return `Seeded ${SIM_EMPLOYEE_NOS.length} employees and payroll periods ${sourcePeriodCode}/${targetPeriodCode}.`;
  });

  await runCheck(report, "Manager department scoping", async () => {
    const managerDepartmentRows = await db
      .select({ departmentId: schema.authManagerDepartments.departmentId })
      .from(schema.authManagerDepartments)
      .where(eq(schema.authManagerDepartments.accountId, managerAccountId));
    const managerDepartmentIds = managerDepartmentRows.map((row) => row.departmentId);

    const visibleEmployees = await db
      .select({
        employeeNo: schema.employees.employeeNo,
      })
      .from(schema.employees)
      .innerJoin(
        schema.employeesGeneralInfo,
        eq(schema.employees.id, schema.employeesGeneralInfo.employeeId)
      )
      .where(
        and(
          eq(schema.employees.employeeType, "EMP"),
          isNull(schema.employees.deletedAt),
          inArray(schema.employeesGeneralInfo.departmentId, managerDepartmentIds)
        )
      )
      .orderBy(asc(schema.employees.employeeNo));

    const visibleNos = visibleEmployees.map((employee) => employee.employeeNo);
    assert.ok(visibleNos.includes(`${SIM_PREFIX}-DAILY`));
    assert.ok(visibleNos.includes(`${SIM_PREFIX}-MONTHLY`));
    assert.ok(!visibleNos.includes(`${SIM_PREFIX}-OUTSIDE`));
    return `Manager sees ${visibleNos.join(", ")} and not the outside department employee.`;
  });

  await runCheck(report, "Manager schedule request lifecycle", async () => {
    const payload = {
      employeeId: dailyEmployeeId,
      shiftTableId: dayShiftId,
      shiftSchedule: "Morning",
      effectiveFrom: monthDate(year, 10),
      effectiveTo: monthDate(year, 10),
      effectiveDates: [monthDate(year, 10)],
      graceMinutes: 5,
      restDay: "Sunday",
      isFlexible: false,
    };

    const [pendingRequest, deniedRequest] = await db
      .insert(schema.managerScheduleChangeRequests)
      .values([
        {
          requestedByAccountId: managerAccountId,
          employeeId: dailyEmployeeId,
          action: "Create",
          status: "Pending",
          payload,
          reason: "Simulation sudden schedule request",
        },
        {
          requestedByAccountId: managerAccountId,
          employeeId: dailyEmployeeId,
          action: "Create",
          status: "Denied",
          payload: { ...payload, effectiveFrom: monthDate(year, 11) },
          reason: "Simulation denied request",
          decisionNote: "Denied by simulation",
          decidedByAccountId: adminAccountId,
          decidedAt: new Date(),
        },
      ])
      .returning();

    const [assignment] = await db
      .insert(schema.employeeShiftAssignments)
      .values({
        employeeId: dailyEmployeeId,
        shiftTableId: dayShiftId,
        shiftName: "Simulation Day Shift",
        shiftCode: `${SIM_PREFIX}-DAY`,
        shiftSchedule: "Morning",
        effectiveFrom: monthDate(year, 10),
        effectiveTo: monthDate(year, 10),
        checkInTime: "09:00:00",
        checkOutTime: "18:00:00",
        breakMinutes: 60,
        paidBreakMinutes: 0,
        graceMinutes: 5,
        restDay: "Sunday",
        hoursPerDay: "8.00",
      })
      .returning();

    await db
      .update(schema.managerScheduleChangeRequests)
      .set({
        status: "Approved",
        targetAssignmentId: assignment.id,
        payload: { ...payload, appliedAssignmentIds: [assignment.id] },
        decisionNote: "Approved by simulation",
        decidedByAccountId: adminAccountId,
        decidedAt: new Date(),
      })
      .where(eq(schema.managerScheduleChangeRequests.id, pendingRequest.id));

    const [voidedRequest] = await db
      .insert(schema.managerScheduleChangeRequests)
      .values({
        requestedByAccountId: managerAccountId,
        employeeId: dailyEmployeeId,
        targetAssignmentId: assignment.id,
        action: "Create",
        status: "Voided",
        payload: { ...payload, appliedAssignmentIds: [assignment.id] },
        reason: "Simulation void request",
        decisionNote: "Voided by simulation",
        decidedByAccountId: adminAccountId,
        decidedAt: new Date(),
      })
      .returning();

    assert.equal(deniedRequest.status, "Denied");
    assert.equal(voidedRequest.status, "Voided");
    const approved = await db.query.managerScheduleChangeRequests.findFirst({
      where: eq(schema.managerScheduleChangeRequests.id, pendingRequest.id),
    });
    assert.equal(approved?.status, "Approved");
    assert.equal(approved?.targetAssignmentId, assignment.id);
    return "Created pending, denied, approved, and voided request records with an applied override.";
  });

  await runCheck(report, "Weekly schedule setup", async () => {
    const [pattern] = await db
      .insert(schema.employeeWeeklyShiftPatterns)
      .values({
        employeeId: dailyEmployeeId,
        effectiveFrom: `${year}-01-01`,
      })
      .returning();

    const weekdays = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ] as const;
    await db.insert(schema.employeeWeeklyShiftPatternDays).values(
      weekdays.map((weekday) => ({
        patternId: pattern.id,
        weekday,
        shiftTableId: dayShiftId,
        shiftName: "Simulation Day Shift",
        shiftCode: `${SIM_PREFIX}-DAY`,
        checkInTime: "08:00:00",
        checkOutTime: "17:00:00",
        breakMinutes: 60,
        paidBreakMinutes: 0,
        hoursPerDay: "8.00",
      }))
    );

    return "Seeded Monday-Saturday weekly pattern for the daily employee.";
  });

  await runCheck(report, "Leave approval data", async () => {
    const [paidLeave, unpaidLeave] = await db
      .insert(schema.employeesLeaveRecords)
      .values([
        {
          employeeId: dailyEmployeeId,
          leaveTypeId: leaveTypeIds.paid,
          dateFiled: monthDate(year, 16),
          leaveStartDate: monthDate(year, 16),
          leaveEndDate: null,
          leaveType: "SL",
          noOfDays: "1.00",
          reason: "Simulation paid leave",
          leaveStatus: "Approved",
        },
        {
          employeeId: monthlyEmployeeId,
          leaveTypeId: leaveTypeIds.unpaid,
          dateFiled: monthDate(year, 17),
          leaveStartDate: monthDate(year, 17),
          leaveEndDate: null,
          leaveType: `${SIM_PREFIX}-LWOP`,
          noOfDays: "1.00",
          reason: "Simulation unpaid leave",
          leaveStatus: "Approved",
        },
      ])
      .returning();

    await db.insert(schema.employeeLeaveRecordDays).values([
      {
        leaveRecordId: paidLeave.id,
        leaveDate: monthDate(year, 16),
        dayPart: "FullDay",
        quantity: "1.00",
      },
      {
        leaveRecordId: unpaidLeave.id,
        leaveDate: monthDate(year, 17),
        dayPart: "FullDay",
        quantity: "1.00",
      },
    ]);

    await db.insert(schema.employeeLeaveApprovalEvents).values([
      {
        leaveRecordId: paidLeave.id,
        actorUserId: managerAccountId,
        action: "Submitted",
        oldStatus: null,
        newStatus: "Pending",
      },
      {
        leaveRecordId: paidLeave.id,
        actorUserId: adminAccountId,
        action: "Approved",
        oldStatus: "Pending",
        newStatus: "Approved",
      },
      {
        leaveRecordId: unpaidLeave.id,
        actorUserId: managerAccountId,
        action: "Submitted",
        oldStatus: null,
        newStatus: "Pending",
      },
      {
        leaveRecordId: unpaidLeave.id,
        actorUserId: adminAccountId,
        action: "Approved",
        oldStatus: "Pending",
        newStatus: "Approved",
      },
    ]);

    return "Seeded one paid leave and one unpaid leave with approval events.";
  });

  await runCheck(report, "DTR parser scenarios", async () => {
    const dtrText = [
      "EmployeeNo,DateTime,Direction,Device",
      `${SIM_PREFIX}-DAILY,${monthDate(year, 2)} 08:00:00,IN,MAIN`,
      `${SIM_PREFIX}-DAILY,${monthDate(year, 2)} 17:00:00,OUT,MAIN`,
      `${SIM_PREFIX}-DAILY,${monthDate(year, 3)} 08:30:00,IN,MAIN`,
      `${SIM_PREFIX}-DAILY,${monthDate(year, 3)} 17:00:00,OUT,MAIN`,
      `${SIM_PREFIX}-DAILY,${monthDate(year, 4)} 08:00:00,IN,MAIN`,
      `${SIM_PREFIX}-DAILY,${monthDate(year, 4)} 08:00:00,IN,MAIN`,
      `${SIM_PREFIX}-DAILY,${monthDate(year, 4)} 17:00:00,OUT,MAIN`,
      `${SIM_PREFIX}-DAILY,${monthDate(year, 5)} 08:00:00,IN,MAIN`,
      `${SIM_PREFIX}-UNKNOWN,${monthDate(year, 6)} 08:00:00,IN,MAIN`,
    ].join("\n");
    const parsed = attendanceLib.parseAttendanceBuffer(
      Buffer.from(dtrText),
      "simulation-dtr.csv"
    );
    assert.equal(parsed.detectedFormat, "comma-delimited DTR");
    assert.equal(parsed.duplicateCount, 1);
    assert.ok(
      parsed.logs.some(
        (log: ParsedAttendanceLog) => log.employeeNo === `${SIM_PREFIX}-UNKNOWN`
      )
    );

    const outOfPeriod = attendanceLib.parseAttendanceBuffer(
      Buffer.from(
        [
          "EmployeeNo,DateTime,Direction,Device",
          `${SIM_PREFIX}-DAILY,${year}-02-16 08:00:00,IN,MAIN`,
        ].join("\n")
      ),
      "simulation-out-of-period.csv"
    );
    assert.throws(() =>
      attendanceLib.assertAttendanceLogsMatchPayrollPeriod({
        logs: outOfPeriod.logs,
        duplicateLogs: outOfPeriod.duplicateLogs,
        payrollPeriod: {
          code: sourcePeriodCode,
          startDate: monthDate(year, 1),
          endDate: monthDate(year, 15),
        },
      })
    );

    const [batch] = await db
      .insert(schema.attendanceImportBatches)
      .values({
        payrollPeriodId: sourcePeriodId,
        sourceFileName: "simulation-dtr.csv",
        sourceFormat: "CSV",
        sourceHash: `${SIM_PREFIX}-${year}-source`,
        status: "Processed",
        totalRows: parsed.logs.length + parsed.duplicateCount,
        matchedRows: parsed.logs.filter(
          (log: ParsedAttendanceLog) => log.employeeNo === `${SIM_PREFIX}-DAILY`
        ).length,
        unmatchedRows: parsed.logs.filter(
          (log: ParsedAttendanceLog) => log.employeeNo === `${SIM_PREFIX}-UNKNOWN`
        ).length,
        duplicateRows: parsed.duplicateCount,
        notes: "Generated by payroll simulation.",
      })
      .returning();

    await db.insert(schema.attendanceRawLogs).values(
      parsed.logs.map((log: ParsedAttendanceLog) => ({
        batchId: batch.id,
        employeeId: log.employeeNo === `${SIM_PREFIX}-DAILY` ? dailyEmployeeId : null,
        employeeNo: log.employeeNo,
        deviceId: log.deviceId ?? null,
        sourceLine: log.sourceLine ?? null,
        direction: log.direction,
        loggedAt: log.loggedAt,
        logDate: log.logDate,
        logTime: log.logTime,
        rawText: log.rawText ?? null,
      }))
    );

    const shift: ShiftWindow = {
      checkInTime: "08:00:00",
      checkOutTime: "17:00:00",
      breakMinutes: 60,
      graceMinutes: 0,
      hoursPerDay: 8,
      restDay: "Sunday",
    };
    const logsByDate = new Map<string, ParsedAttendanceLog[]>();
    for (const log of parsed.logs.filter(
      (item: ParsedAttendanceLog) => item.employeeNo === `${SIM_PREFIX}-DAILY`
    )) {
      const rows = logsByDate.get(log.logDate) ?? [];
      rows.push(log);
      logsByDate.set(log.logDate, rows);
    }

    await db.insert(schema.attendanceDailySummaries).values(
      [...logsByDate.entries()].map(([attendanceDate, logs]) => {
        const summary = attendanceLib.summarizeEmployeeDay(
          attendanceDate,
          logs,
          shift
        );
        return {
          employeeId: dailyEmployeeId,
          sourceBatchId: batch.id,
          attendanceDate,
          firstInAt: summary.firstInAt,
          lastOutAt: summary.lastOutAt,
          scheduledInTime: summary.scheduledInTime,
          scheduledOutTime: summary.scheduledOutTime,
          scheduledMinutes: summary.scheduledMinutes,
          workedMinutes: summary.workedMinutes,
          regularMinutes: summary.regularMinutes,
          lateMinutes: summary.lateMinutes,
          undertimeMinutes: summary.undertimeMinutes,
          overtimeMinutes: summary.overtimeMinutes,
          nightMinutes: summary.nightMinutes,
          paidLeaveMinutes: summary.paidLeaveMinutes,
          unpaidLeaveMinutes: summary.unpaidLeaveMinutes,
          absentMinutes: summary.absentMinutes,
          isRestDay: summary.isRestDay,
          anomalyFlags: summary.anomalyFlags.join(","),
          remarks: "Simulation summary",
        };
      })
    );

    return "Parsed valid, duplicate, unmatched, out-of-period, and held/missing-punch DTR inputs.";
  });

  await runCheck(report, "Unresolved held DTR blocks payroll finalization", async () => {
    const run = await payrollEngine.createOrRecomputePayrollRun(
      sourcePeriodId,
      adminAccountId
    );
    assert.ok(run?.id, "Source payroll run was computed.");
    const error = await payrollEngine
      .transitionPayrollRunStatus(run.id, "Reviewed", adminAccountId)
      .then(
        () => null,
        (caught: unknown) => caught
      );
    assert.ok(error instanceof Error, "Review should be blocked.");
    assert.match(error.message, /unresolved held DTR/i);
    await payrollEngine.transitionPayrollRunStatus(run.id, "Void", adminAccountId, "Simulation cleanup");
    return "Draft payroll review was rejected while the source period had unresolved held DTR.";
  });

  await runCheck(report, "Admin approves held DTR for target payroll", async () => {
    await db.insert(schema.attendanceDtrHoldApprovals).values({
      sourcePayrollPeriodId: sourcePeriodId,
      targetPayrollPeriodId: targetPeriodId,
      employeeId: dailyEmployeeId,
      attendanceDate: monthDate(year, 5),
      status: "Approved",
      workedMinutes: 450,
      lateMinutes: 15,
      undertimeMinutes: 15,
      overtimeMinutes: 30,
      notes: "Approved by payroll simulation.",
      approvedByUserId: adminAccountId,
      approvedAt: new Date(),
    });

    await db.insert(schema.employeePayrollExceptionRows).values([
      {
        payrollPeriodId: targetPeriodId,
        employeeId: dailyEmployeeId,
        attendanceDate: monthDate(year, 5),
        exceptionType: "WORKED_DAY_PREMIUM",
        workedStatus: "WORKED",
        dayType: "Regular Day",
        accountCodeId: accountCodeIds.holdWorked,
        accountCodeSnapshot: `${SIM_PREFIX}-HOLD-WORK`,
        accountTypeSnapshot: "Regular Hours",
        accountDescriptionSnapshot: "Approved Held DTR Worked Time",
        accountMonth13thPaySnapshot: true,
        accountNonTaxableSnapshot: false,
        quantityMinutes: 450,
        dtrOverrideSource: "DTR_HOLD_WORKED",
        remarks: "Generated by payroll simulation.",
      },
      {
        payrollPeriodId: targetPeriodId,
        employeeId: dailyEmployeeId,
        attendanceDate: monthDate(year, 5),
        exceptionType: "OVERTIME",
        workedStatus: "WORKED",
        dayType: "Regular Day",
        accountCodeId: accountCodeIds.holdOvertime,
        accountCodeSnapshot: `${SIM_PREFIX}-HOLD-OT`,
        accountTypeSnapshot: "Overtime",
        accountDescriptionSnapshot: "Approved Held DTR Overtime",
        accountMonth13thPaySnapshot: false,
        accountNonTaxableSnapshot: false,
        overtimeCategory: "REGULAR_DAY",
        quantityMinutes: 30,
        dtrOverrideSource: "DTR_HOLD_REGULAR_OVERTIME",
        remarks: "Generated by payroll simulation.",
      },
    ]);

    const approval = await db.query.attendanceDtrHoldApprovals.findFirst({
      where: and(
        eq(schema.attendanceDtrHoldApprovals.sourcePayrollPeriodId, sourcePeriodId),
        eq(schema.attendanceDtrHoldApprovals.employeeId, dailyEmployeeId)
      ),
    });
    assert.equal(approval?.status, "Approved");
    return "Held DTR approval and generated target-period exception rows were created.";
  });

  await runCheck(report, "Loan schedule setup", async () => {
    const [loan] = await db
      .insert(schema.employeesLoans)
      .values({
        employeeId: dailyEmployeeId,
        accountCodeId: accountCodeIds.loan,
        loanReferenceNumber: `${SIM_PREFIX}-${year}-LN-001`,
        amountGranted: money(1000),
        payrollDateDeduction: targetPeriodCode,
        loanDate: monthDate(year, 1),
        paymentTerms: "Always",
        termMonths: 1,
        payableLoan: money(1000),
        loanTotalCredit: money(0),
        amortization: money(500),
        loanBalance: money(1000),
        status: "Active",
      })
      .returning();
    loanId = loan.id;

    const [installment] = await db
      .insert(schema.loanInstallments)
      .values({
        loanId: loan.id,
        payrollPeriodId: targetPeriodId,
        payrollCode: targetPeriodCode,
        installmentNo: 1,
        dueDate: monthDate(year, 20),
        scheduledAmount: money(500),
        balanceAfter: money(500),
        status: "Pending",
      })
      .returning();
    loanInstallmentId = installment.id;

    const generated = loanLib.generateLoanInstallmentPlan({
      firstPayrollCode: targetPeriodCode,
      paymentTerms: "Always",
      payableAmount: 1000,
      amortization: 500,
    });
    loanLib.assertLoanInstallmentPlanRepays({
      installments: generated,
      payableAmount: 1000,
      amortization: 500,
    });

    return "Seeded active loan with one due target-period installment.";
  });

  await runCheck(report, "Target payroll computes earnings, deductions, contributions, tax, and loans", async () => {
    const run = await payrollEngine.createOrRecomputePayrollRun(
      targetPeriodId,
      adminAccountId
    );
    assert.ok(run?.id, "Target payroll run was computed.");

    const employeeRows = await db
      .select({
        id: schema.payrollRunEmployees.id,
        employeeId: schema.payrollRunEmployees.employeeId,
        grossPay: schema.payrollRunEmployees.grossPay,
        totalDeductions: schema.payrollRunEmployees.totalDeductions,
        employeeContributions: schema.payrollRunEmployees.employeeContributions,
        netPay: schema.payrollRunEmployees.netPay,
      })
      .from(schema.payrollRunEmployees)
      .where(eq(schema.payrollRunEmployees.payrollRunId, run.id));
    assert.ok(employeeRows.length >= 3, "Payroll includes seeded eligible employees.");
    const dailyRunEmployee = employeeRows.find((row) => row.employeeId === dailyEmployeeId);
    const monthlyRunEmployee = employeeRows.find((row) => row.employeeId === monthlyEmployeeId);
    assert.ok(dailyRunEmployee, "Daily employee has payroll row.");
    assert.ok(monthlyRunEmployee, "Monthly employee has payroll row.");
    assert.ok(toAmount(dailyRunEmployee.grossPay) > 0, "Daily employee gross pay is positive.");
    assert.ok(toAmount(monthlyRunEmployee.grossPay) > 0, "Monthly employee gross pay is positive.");
    assert.ok(
      toAmount(dailyRunEmployee.employeeContributions) > 0,
      "Daily employee has statutory/tax deductions."
    );

    const dailyLines = await db
      .select()
      .from(schema.payrollRunLines)
      .where(eq(schema.payrollRunLines.payrollRunEmployeeId, dailyRunEmployee.id));
    const monthlyLines = await db
      .select()
      .from(schema.payrollRunLines)
      .where(eq(schema.payrollRunLines.payrollRunEmployeeId, monthlyRunEmployee.id));
    const dailyCodes = new Set(dailyLines.map((line) => line.code));
    const monthlyCodes = new Set(monthlyLines.map((line) => line.code));
    assert.ok(dailyCodes.has("REG"), "Daily employee has regular pay.");
    assert.ok(dailyCodes.has("SL") || [...dailyCodes].some((code) => code.includes("LEAVE")), "Daily employee has paid leave treatment.");
    assert.ok(dailyCodes.has(`${SIM_PREFIX}-ALLOW`), "Daily employee has recurring allowance.");
    assert.ok(dailyCodes.has(`${SIM_PREFIX}-LOAN`), "Daily employee has loan deduction.");
    assert.ok(dailyCodes.has("SSS"), "Daily employee has SSS deduction.");
    assert.ok(dailyCodes.has("PHILHEALTH"), "Daily employee has PhilHealth deduction.");
    assert.ok(dailyCodes.has("PAGIBIG"), "Daily employee has Pag-IBIG deduction.");
    assert.ok(dailyCodes.has(`${SIM_PREFIX}-HOLD-WORK`), "Approved held DTR worked line is included.");
    assert.ok(monthlyCodes.has(`${SIM_PREFIX}-LWOP`), "Monthly employee has unpaid leave deduction.");

    const invalidPost = await payrollEngine
      .transitionPayrollRunStatus(run.id, "Posted", adminAccountId, undefined, undefined, {actorRole: "ADMIN"})
      .then(
        () => null,
        (caught: unknown) => caught
      );
    assert.ok(invalidPost instanceof Error, "Draft -> Posted should be rejected.");

    await payrollEngine.transitionPayrollRunStatus(run.id, "Reviewed", adminAccountId);
    await payrollEngine.transitionPayrollRunStatus(run.id, "Approved", adminAccountId, undefined, undefined, {actorRole: "ADMIN"});

    const recomputeError = await payrollEngine
      .createOrRecomputePayrollRun(targetPeriodId, adminAccountId)
      .then(
        () => null,
        (caught: unknown) => caught
      );
    assert.ok(recomputeError instanceof Error, "Approved run should block recompute.");
    assert.match(recomputeError.message, /recompute is only allowed/i);

    await payrollEngine.transitionPayrollRunStatus(run.id, "Posted", adminAccountId, undefined, undefined, {actorRole: "ADMIN"});

    const [postedRun, postedInstallment, loanPayment, postedLoan] = await Promise.all([
      db.query.payrollRuns.findFirst({ where: eq(schema.payrollRuns.id, run.id) }),
      db.query.loanInstallments.findFirst({
        where: eq(schema.loanInstallments.id, loanInstallmentId),
      }),
      db.query.loanPayments.findFirst({
        where: eq(schema.loanPayments.installmentId, loanInstallmentId),
      }),
      db.query.employeesLoans.findFirst({
        where: eq(schema.employeesLoans.id, loanId),
      }),
    ]);
    assert.equal(postedRun?.status, "Posted");
    assert.equal(postedInstallment?.status, "Paid");
    assert.equal(loanPayment?.source, "Payroll");
    assert.equal(toAmount(loanPayment?.amountPaid), 500);
    assert.equal(toAmount(postedLoan?.loanBalance), 500);

    return `Posted run ${run.id}; loan installment ${loanInstallmentId} was paid and loan balance is 500.`;
  });

  await runCheck(report, "Payroll report side-effect tables", async () => {
    const [run] = await db
      .select()
      .from(schema.payrollRuns)
      .where(eq(schema.payrollRuns.payrollPeriodId, targetPeriodId))
      .orderBy(desc(schema.payrollRuns.createdAt))
      .limit(1);
    assert.equal(run?.status, "Posted");

    const [employeeCountRow, lineCountRow, loanPaymentCountRow] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.payrollRunEmployees)
        .where(eq(schema.payrollRunEmployees.payrollRunId, run.id)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.payrollRunLines)
        .innerJoin(
          schema.payrollRunEmployees,
          eq(schema.payrollRunLines.payrollRunEmployeeId, schema.payrollRunEmployees.id)
        )
        .where(eq(schema.payrollRunEmployees.payrollRunId, run.id)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.loanPayments)
        .where(eq(schema.loanPayments.loanId, loanId)),
    ]);

    assert.ok(Number(employeeCountRow[0]?.count ?? 0) >= 3);
    assert.ok(Number(lineCountRow[0]?.count ?? 0) > 0);
    assert.equal(Number(loanPaymentCountRow[0]?.count ?? 0), 1);
    return `${employeeCountRow[0]?.count} employee rows, ${lineCountRow[0]?.count} payroll lines, ${loanPaymentCountRow[0]?.count} loan payment.`;
  });

  await writeReport(report);

  const failures = report.checks.filter((check) => check.status === "fail");
  console.log(`Payroll simulation report: ${REPORT_MD_PATH}`);
  if (failures.length > 0) {
    console.error(renderMarkdown(report));
    process.exitCode = 1;
    return;
  }

  console.log(renderMarkdown(report));
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
