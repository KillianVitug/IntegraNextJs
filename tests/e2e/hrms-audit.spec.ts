import { expect, test, type Browser, type Page } from "@playwright/test";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { config as loadEnv } from "dotenv";
import fs from "fs";
import path from "path";
import ws from "ws";

const ROOT_DIR = process.cwd();
const REPORT_DIR = path.join(ROOT_DIR, "test-results");
const REPORT_JSON_PATH = path.join(REPORT_DIR, "hrms-audit.json");
const REPORT_MD_PATH = path.join(REPORT_DIR, "hrms-audit.md");
const DRAFT_SAFE_RUN_STATUSES = new Set(["Draft", "Stale", "Void"]);
let dbPool: Pool | null = null;

loadEnv({ path: path.join(ROOT_DIR, ".env.local") });
neonConfig.webSocketConstructor = ws;

type IssueSeverity = "error" | "warning" | "info";
type CheckStatus = "pass" | "fail" | "warn" | "skip";

type AuditIssue = {
  severity: IssueSeverity;
  area: string;
  title: string;
  details?: string;
  evidence?: string[];
};

type AuditCheck = {
  name: string;
  status: CheckStatus;
  details?: string;
};

type RouteAuditResult = {
  route: string;
  source: "admin-header" | "employee-header" | "hrms-module" | "static-page";
  staticPageExists: boolean;
  statusCode?: number | null;
  finalUrl?: string;
  pageState?: "ok" | "not-found" | "error" | "redirect" | "unknown";
  details?: string;
};

type SafePayrollPeriod = {
  id: string;
  code: string;
  latestRunStatus: string | null;
  latestRunNumber: number | null;
};

type DbAudit = {
  counts: Record<string, number>;
  employeeReadiness: {
    activeEmployeeCount: number;
    payrollEligibleEmployeeCount: number;
    missingGeneralInfoCount: number;
    missingPayrollTermsCount: number;
    missingSalaryCount: number;
    missingTimekeepingCount: number;
    missingEmailCount: number;
    missingDepartmentCount: number;
    samples: Record<string, string[]>;
  };
  constants: Record<string, number>;
  payroll: {
    year: number;
    periodsForYear: number;
    safeDraftPeriod: SafePayrollPeriod | null;
    latestRunByPeriod: Array<{
      code: string;
      latestRunStatus: string | null;
      latestRunNumber: number | null;
    }>;
  };
};

type DbEmployeeReadinessRow = {
  employeeId: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  generalInfoEmployeeId: string | null;
  payrollTerms: string | null;
  separationDate: string | null;
  departmentId: number | null;
  salaryEmployeeId: string | null;
  dailyRate: string | null;
  monthlyRate: string | null;
  timekeepingEmployeeId: string | null;
  email: string | null;
};

type DbPayrollPeriodRow = {
  id: string;
  code: string;
  startDate: string;
};

type DbPayrollRunRow = {
  id: string;
  payrollPeriodId: string;
  status: string;
  runNumber: number;
  createdAt: Date | string;
};

type PayrollSimulation = {
  status: CheckStatus;
  details: string;
  seededPeriods: boolean;
  selectedPeriod?: SafePayrollPeriod;
  latestRun?: {
    id: string;
    status: string;
    runNumber: number;
    employeeRows: number;
  } | null;
};

type AuditReport = {
  generatedAt: string;
  baseURL: string;
  payrollYear: number;
  mode: "draft-only";
  checks: AuditCheck[];
  issues: AuditIssue[];
  dbAudit?: DbAudit;
  routes: RouteAuditResult[];
  payrollSimulation?: PayrollSimulation;
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
};

const ADMIN_MODULE_ROUTES = [
  "/home",
  "/employeeMaster",
  "/employeeMaster/form",
  "/leaves",
  "/leaves/form",
  "/salaryAdjustment",
  "/payroll",
  "/loans",
  "/loans/form",
  "/employeeFiles",
  "/employeeFiles/form",
  "/access-management",
  "/constants/accountCode/form",
  "/constants/slvlGroupCode/form",
  "/constants/departmentCode/form",
  "/constants/positionCode/form",
  "/constants/payrollCode",
  "/constants/payrollCode/form",
  "/constants/leaveTypeCode/form",
  "/constants/holidayCode/form",
  "/constants/shiftTable/form",
  "/constants/undertimeTable/form",
  "/constants/overtimeTable/form",
  "/constants/tardinessTable/form",
  "/constants/statutoryRuleVersion/form",
  "/constants/sssContributionBracket/form",
  "/constants/philhealthContributionRate/form",
  "/constants/pagibigContributionRate/form",
  "/constants/birWithholdingTaxBracket/form",
  "/shiftAssignments",
  "/weeklyShiftPatterns",
] as const;

function normalizeBaseURL() {
  return (process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000").replace(
    /\/$/,
    ""
  );
}

function getPayrollYear() {
  const parsed = Number(process.env.PLAYWRIGHT_PAYROLL_YEAR);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100
    ? parsed
    : new Date().getFullYear();
}

function createReport(): AuditReport {
  return {
    generatedAt: new Date().toISOString(),
    baseURL: normalizeBaseURL(),
    payrollYear: getPayrollYear(),
    mode: "draft-only",
    checks: [],
    issues: [],
    routes: [],
    summary: {
      errors: 0,
      warnings: 0,
      info: 0,
    },
  };
}

function addCheck(report: AuditReport, check: AuditCheck) {
  report.checks.push(check);
}

function addIssue(report: AuditReport, issue: AuditIssue) {
  report.issues.push(issue);
}

function updateSummary(report: AuditReport) {
  report.summary = {
    errors: report.issues.filter((issue) => issue.severity === "error").length,
    warnings: report.issues.filter((issue) => issue.severity === "warning").length,
    info: report.issues.filter((issue) => issue.severity === "info").length,
  };
}

function toAbsoluteUrl(route: string) {
  return `${normalizeBaseURL()}${route.startsWith("/") ? route : `/${route}`}`;
}

function readRouteLinksFromFile(filePath: string) {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf8");
  const routes = new Set<string>();
  const hrefPattern = /href(?:\s*=\s*|\s*:\s*)["']([^"']+)["']/g;

  for (const match of content.matchAll(hrefPattern)) {
    const route = match[1];
    if (route?.startsWith("/")) {
      routes.add(route);
    }
  }

  return [...routes].sort();
}

function routeSegments(route: string) {
  return route
    .split("?")[0]
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function possiblePageFilesForRoute(route: string) {
  const segments = routeSegments(route);
  const routeGroups = ["", "(ntg)", "(employee)"];

  if (route === "/") {
    return [path.join(ROOT_DIR, "src", "app", "page.tsx")];
  }

  return routeGroups.map((group) =>
    group
      ? path.join(ROOT_DIR, "src", "app", group, ...segments, "page.tsx")
      : path.join(ROOT_DIR, "src", "app", ...segments, "page.tsx")
  );
}

function routeHasPage(route: string) {
  return possiblePageFilesForRoute(route).some((filePath) => fs.existsSync(filePath));
}

function routeFromPageFile(filePath: string) {
  const relative = path.relative(path.join(ROOT_DIR, "src", "app"), filePath);
  const parts = relative.split(path.sep).filter((part) => {
    return part !== "page.tsx" && !/^\(.+\)$/.test(part);
  });

  if (parts.length === 0) return "/";
  return `/${parts.join("/")}`;
}

function collectPageRoutes() {
  const appDir = path.join(ROOT_DIR, "src", "app");
  const found: string[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name === "page.tsx") {
        found.push(routeFromPageFile(fullPath));
      }
    }
  }

  walk(appDir);
  return [...new Set(found)].sort();
}

function collectStaticRouteAudit(report: AuditReport) {
  const adminHeaderRoutes = readRouteLinksFromFile(
    path.join(ROOT_DIR, "src", "components", "Header.tsx")
  );
  const employeeHeaderRoutes = readRouteLinksFromFile(
    path.join(ROOT_DIR, "src", "components", "EmployeeHeader.tsx")
  );
  const routeSources = new Map<string, RouteAuditResult["source"]>();

  for (const route of ADMIN_MODULE_ROUTES) {
    routeSources.set(route, "hrms-module");
  }
  for (const route of adminHeaderRoutes) {
    routeSources.set(route, "admin-header");
  }
  for (const route of employeeHeaderRoutes) {
    routeSources.set(route, "employee-header");
  }

  for (const [route, source] of routeSources.entries()) {
    const staticPageExists = routeHasPage(route);
    report.routes.push({ route, source, staticPageExists });

    if (!staticPageExists) {
      addIssue(report, {
        severity: "error",
        area: "Route map",
        title: `Navigation route has no page: ${route}`,
        details: `The ${source} route does not resolve to a src/app page.tsx file.`,
        evidence: possiblePageFilesForRoute(route).map((filePath) =>
          path.relative(ROOT_DIR, filePath)
        ),
      });
    }
  }

  const linkedRoutes = new Set(routeSources.keys());
  const orphanPages = collectPageRoutes().filter((route) => {
    if (route === "/") return false;
    if (linkedRoutes.has(route)) return false;
    if (route.includes("[") || route.includes("]")) return false;
    return true;
  });

  if (orphanPages.length > 0) {
    addIssue(report, {
      severity: "info",
      area: "Route map",
      title: "Pages exist outside the audited navigation",
      details: "These routes may be intentional deep links, dashboards, or unfinished entry points.",
      evidence: orphanPages,
    });
  }

  addCheck(report, {
    name: "Static route map",
    status: report.routes.some((route) => !route.staticPageExists) ? "fail" : "pass",
    details: `${routeSources.size} linked routes checked against src/app pages.`,
  });

  return {
    adminHeaderRoutes,
    employeeHeaderRoutes,
  };
}

function getDbPool() {
  if (dbPool) return dbPool;

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is missing. Add it to .env.local so the audit can read HRMS readiness data."
    );
  }

  dbPool = new Pool({ connectionString });
  return dbPool;
}

async function queryRows<T>(
  text: string,
  params: unknown[] = []
) {
  const result = await getDbPool().query(text, params);
  return result.rows as T[];
}

async function queryOne<T>(
  text: string,
  params: unknown[] = []
) {
  const rows = await queryRows<T>(text, params);
  return rows[0] ?? null;
}

async function countTable(tableName: string, whereClause = "") {
  const row = await queryOne<{ count: number }>(
    `select count(*)::int as count from ${tableName} ${whereClause}`
  );
  return Number(row?.count ?? 0);
}

function sampleEmployeeLabels(rows: any[], predicate: (row: any) => boolean) {
  return rows
    .filter(predicate)
    .slice(0, 8)
    .map((row) => `${row.employeeNo} ${row.lastName}, ${row.firstName}`);
}

function hasUsableSalary(row: any) {
  return Number(row.dailyRate ?? 0) > 0 || Number(row.monthlyRate ?? 0) > 0;
}

async function collectDbAudit(year: number): Promise<DbAudit> {
  const activeAdminRow = await queryOne<{ count: number }>(`
    select count(*)::int as count
    from auth_accounts aa
    inner join employees e on aa.employee_id = e.id
    inner join employees_general_info egi on e.id = egi.employee_id
    where aa.status = 'Active'
      and e.deleted_at is null
      and egi.confidentiality_level in ('Supervisory', 'Managerial')
  `);

  const employeeRows = await queryRows<DbEmployeeReadinessRow>(`
    select
      e.id as "employeeId",
      e.employee_no as "employeeNo",
      e.first_name as "firstName",
      e.last_name as "lastName",
      egi.employee_id as "generalInfoEmployeeId",
      egi.payroll_terms as "payrollTerms",
      egi.separation_date as "separationDate",
      egi.department_id as "departmentId",
      es.employee_id as "salaryEmployeeId",
      es.daily_rate as "dailyRate",
      es.monthly_rate as "monthlyRate",
      etk.employee_id as "timekeepingEmployeeId",
      eor.email as "email"
    from employees e
    left join employees_general_info egi on egi.employee_id = e.id
    left join employees_salary es on es.employee_id = e.id
    left join employees_timekeeping etk on etk.employee_id = e.id
    left join employees_other_references eor on eor.employee_id = e.id
    where e.employee_type = 'EMP'
      and e.deleted_at is null
    order by e.employee_no asc
  `);

  const today = new Date().toISOString().slice(0, 10);
  const payrollEligibleRows = employeeRows.filter((row: any) => {
    return (
      row.payrollTerms === "Semi-Monthly" &&
      (!row.separationDate || String(row.separationDate) >= today)
    );
  });

  const [
    employeeCount,
    leaveCount,
    loanCount,
    salaryAdjustmentCount,
    fileCount,
    attendanceSummaryCount,
    attendanceBatchCount,
    payrollRunEmployeeCount,
    departmentCount,
    positionCount,
    slvlGroupCount,
    accountCodeCount,
    leaveTypeCount,
    shiftTableCount,
    shiftAssignmentCount,
    weeklyPatternCount,
    overtimeRuleCount,
    undertimeRuleCount,
    tardinessRuleCount,
    statutoryVersionCount,
    sssBracketCount,
    philhealthRateCount,
    pagibigRateCount,
    birBracketCount,
  ] = await Promise.all([
    countTable("employees", "where deleted_at is null"),
    countTable("employees_leave_records"),
    countTable("employees_loans"),
    countTable("employees_salary_adjustments"),
    countTable("employee_files"),
    countTable("attendance_daily_summaries"),
    countTable("attendance_import_batches"),
    countTable("payroll_run_employees"),
    countTable("department"),
    countTable("position"),
    countTable("slvl_group"),
    countTable('"accountCode"'),
    countTable("leave_types"),
    countTable("shift_tables"),
    countTable("employee_shift_assignments"),
    countTable("employee_weekly_shift_patterns"),
    countTable("overtime_rules"),
    countTable("undertime_rules"),
    countTable("tardiness_rules"),
    countTable("statutory_rule_versions"),
    countTable("sss_contribution_brackets"),
    countTable("philhealth_contribution_rates"),
    countTable("pagibig_contribution_rates"),
    countTable("bir_withholding_tax_brackets"),
  ]);

  const periods = await queryRows<DbPayrollPeriodRow>(
    `
      select
        id,
        code,
        start_date as "startDate"
      from payroll_periods
      where year = $1
      order by start_date asc
    `,
    [year]
  );
  const periodIds = periods.map((period) => period.id);
  const runs =
    periodIds.length > 0
      ? await queryRows<DbPayrollRunRow>(
          `
            select
              id,
              payroll_period_id as "payrollPeriodId",
              status,
              run_number as "runNumber",
              created_at as "createdAt"
            from payroll_runs
            where payroll_period_id = any($1::uuid[])
            order by created_at desc
          `,
          [periodIds]
        )
      : [];
  const latestRunByPeriod = new Map<string, DbPayrollRunRow>();

  for (const run of runs) {
    if (!latestRunByPeriod.has(run.payrollPeriodId)) {
      latestRunByPeriod.set(run.payrollPeriodId, run);
    }
  }

  const safePeriodRow = periods.find((period: any) => {
    const latestRun = latestRunByPeriod.get(period.id);
    return !latestRun || DRAFT_SAFE_RUN_STATUSES.has(latestRun.status);
  });
  const safeRun = safePeriodRow ? latestRunByPeriod.get(safePeriodRow.id) : null;

  return {
    counts: {
      activeAdminAccounts: Number(activeAdminRow?.count ?? 0),
      employees: employeeCount,
      leaves: leaveCount,
      loans: loanCount,
      salaryAdjustments: salaryAdjustmentCount,
      employeeFiles: fileCount,
      attendanceDailySummaries: attendanceSummaryCount,
      attendanceImportBatches: attendanceBatchCount,
      payrollRunEmployees: payrollRunEmployeeCount,
    },
    employeeReadiness: {
      activeEmployeeCount: employeeRows.length,
      payrollEligibleEmployeeCount: payrollEligibleRows.length,
      missingGeneralInfoCount: employeeRows.filter((row: any) => !row.generalInfoEmployeeId)
        .length,
      missingPayrollTermsCount: employeeRows.filter(
        (row: any) => row.payrollTerms !== "Semi-Monthly"
      ).length,
      missingSalaryCount: employeeRows.filter((row: any) => !hasUsableSalary(row)).length,
      missingTimekeepingCount: employeeRows.filter((row: any) => !row.timekeepingEmployeeId)
        .length,
      missingEmailCount: employeeRows.filter((row: any) => !row.email).length,
      missingDepartmentCount: employeeRows.filter((row: any) => row.departmentId == null)
        .length,
      samples: {
        missingGeneralInfo: sampleEmployeeLabels(
          employeeRows,
          (row) => !row.generalInfoEmployeeId
        ),
        missingPayrollTerms: sampleEmployeeLabels(
          employeeRows,
          (row) => row.payrollTerms !== "Semi-Monthly"
        ),
        missingSalary: sampleEmployeeLabels(employeeRows, (row) => !hasUsableSalary(row)),
        missingTimekeeping: sampleEmployeeLabels(
          employeeRows,
          (row) => !row.timekeepingEmployeeId
        ),
        missingEmail: sampleEmployeeLabels(employeeRows, (row) => !row.email),
        missingDepartment: sampleEmployeeLabels(
          employeeRows,
          (row) => row.departmentId == null
        ),
      },
    },
    constants: {
      departments: departmentCount,
      positions: positionCount,
      slvlGroups: slvlGroupCount,
      accountCodes: accountCodeCount,
      leaveTypes: leaveTypeCount,
      shiftTables: shiftTableCount,
      employeeShiftAssignments: shiftAssignmentCount,
      employeeWeeklyShiftPatterns: weeklyPatternCount,
      overtimeRules: overtimeRuleCount,
      undertimeRules: undertimeRuleCount,
      tardinessRules: tardinessRuleCount,
      statutoryRuleVersions: statutoryVersionCount,
      sssContributionBrackets: sssBracketCount,
      philhealthContributionRates: philhealthRateCount,
      pagibigContributionRates: pagibigRateCount,
      birWithholdingTaxBrackets: birBracketCount,
    },
    payroll: {
      year,
      periodsForYear: periods.length,
      safeDraftPeriod: safePeriodRow
        ? {
            id: safePeriodRow.id,
            code: safePeriodRow.code,
            latestRunStatus: safeRun?.status ?? null,
            latestRunNumber: safeRun?.runNumber ?? null,
          }
        : null,
      latestRunByPeriod: periods.map((period: any) => {
        const latestRun = latestRunByPeriod.get(period.id);
        return {
          code: period.code,
          latestRunStatus: latestRun?.status ?? null,
          latestRunNumber: latestRun?.runNumber ?? null,
        };
      }),
    },
  };
}

async function getLatestPayrollRunSummary(periodId: string) {
  const latestRun = await queryOne<{
    id: string;
    status: string;
    runNumber: number;
  }>(
    `
      select
        id,
        status,
        run_number as "runNumber"
      from payroll_runs
      where payroll_period_id = $1
      order by created_at desc
      limit 1
    `,
    [periodId]
  );

  if (!latestRun) return null;

  const employeeRow = await queryOne<{ count: number }>(
    `
      select count(*)::int as count
      from payroll_run_employees
      where payroll_run_id = $1
    `,
    [latestRun.id]
  );

  return {
    id: latestRun.id,
    status: latestRun.status,
    runNumber: latestRun.runNumber,
    employeeRows: Number(employeeRow?.count ?? 0),
  };
}

async function tryCollectDbAudit(
  report: AuditReport,
  year: number,
  context = "Read-only database readiness"
) {
  try {
    return await collectDbAudit(year);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    addIssue(report, {
      severity: "error",
      area: "Database audit",
      title: "Unable to read HRMS database readiness data",
      details,
    });
    addCheck(report, {
      name: context,
      status: "fail",
      details,
    });
    return null;
  }
}

function addDbReadinessIssues(report: AuditReport, dbAudit: DbAudit) {
  if (dbAudit.counts.activeAdminAccounts === 0) {
    addIssue(report, {
      severity: "error",
      area: "Authentication",
      title: "No active admin account found",
      details: "Create or activate an admin account before running browser workflow simulation.",
    });
  }

  if (dbAudit.employeeReadiness.activeEmployeeCount === 0) {
    addIssue(report, {
      severity: "error",
      area: "Employee master",
      title: "No active employees found",
      details: "Payroll simulation needs existing non-deleted employee records.",
    });
  }

  if (dbAudit.employeeReadiness.payrollEligibleEmployeeCount === 0) {
    addIssue(report, {
      severity: "warning",
      area: "Payroll readiness",
      title: "No semi-monthly payroll-eligible employees found",
      details:
        "The payroll engine computes regular employees with Semi-Monthly payroll terms and no pre-period separation.",
    });
  }

  const readinessWarnings: Array<[number, string, string, string[]]> = [
    [
      dbAudit.employeeReadiness.missingPayrollTermsCount,
      "Employee payroll terms are missing or not Semi-Monthly",
      "Payroll v1 computes semi-monthly employees only.",
      dbAudit.employeeReadiness.samples.missingPayrollTerms,
    ],
    [
      dbAudit.employeeReadiness.missingSalaryCount,
      "Employees are missing usable salary rates",
      "At least one of daily rate or monthly rate should be present for payroll computation.",
      dbAudit.employeeReadiness.samples.missingSalary,
    ],
    [
      dbAudit.employeeReadiness.missingTimekeepingCount,
      "Employees are missing timekeeping setup",
      "Timekeeping setup is needed for schedule and attendance-derived payroll.",
      dbAudit.employeeReadiness.samples.missingTimekeeping,
    ],
    [
      dbAudit.employeeReadiness.missingEmailCount,
      "Employees are missing email references",
      "Employee login and communication features depend on employee reference email.",
      dbAudit.employeeReadiness.samples.missingEmail,
    ],
    [
      dbAudit.employeeReadiness.missingDepartmentCount,
      "Employees are missing department assignment",
      "Reports and filters work better when employees have department metadata.",
      dbAudit.employeeReadiness.samples.missingDepartment,
    ],
  ];

  for (const [count, title, details, samples] of readinessWarnings) {
    if (count > 0) {
      addIssue(report, {
        severity: "warning",
        area: "Employee readiness",
        title,
        details: `${details} Count: ${count}.`,
        evidence: samples,
      });
    }
  }

  const requiredConstantGroups: Array<[number, string, string]> = [
    [dbAudit.constants.accountCodes, "Account codes", "Payroll line mapping needs account codes."],
    [dbAudit.constants.leaveTypes, "Leave types", "Leave and paid leave handling needs leave type setup."],
    [dbAudit.constants.shiftTables, "Shift tables", "Attendance and DTR review need shift setup."],
    [
      dbAudit.constants.statutoryRuleVersions,
      "Statutory rule versions",
      "Government contribution and tax calculations need active statutory versions.",
    ],
    [
      dbAudit.constants.sssContributionBrackets,
      "SSS brackets",
      "SSS computation needs contribution brackets.",
    ],
    [
      dbAudit.constants.philhealthContributionRates,
      "PhilHealth rates",
      "PhilHealth computation needs rate rows.",
    ],
    [
      dbAudit.constants.pagibigContributionRates,
      "Pag-IBIG rates",
      "Pag-IBIG computation needs rate rows.",
    ],
    [
      dbAudit.constants.birWithholdingTaxBrackets,
      "BIR withholding brackets",
      "Withholding tax computation needs tax brackets.",
    ],
  ];

  for (const [count, title, details] of requiredConstantGroups) {
    if (count === 0) {
      addIssue(report, {
        severity: "warning",
        area: "Payroll constants",
        title: `${title} are missing`,
        details,
      });
    }
  }

  if (dbAudit.payroll.periodsForYear === 0) {
    addIssue(report, {
      severity: "info",
      area: "Payroll periods",
      title: `No payroll periods exist for ${dbAudit.payroll.year}`,
      details: "The draft-only simulation will try to seed periods from the Payroll Workspace UI.",
    });
  }

  addCheck(report, {
    name: "Read-only database readiness",
    status:
      dbAudit.counts.activeAdminAccounts > 0 &&
      dbAudit.employeeReadiness.activeEmployeeCount > 0
        ? "pass"
        : "fail",
    details: `${dbAudit.employeeReadiness.activeEmployeeCount} active employee(s), ${dbAudit.employeeReadiness.payrollEligibleEmployeeCount} payroll-eligible employee(s).`,
  });
}

async function login(page: Page, email: string, password: string) {
  await page.goto(toAbsoluteUrl("/"), { waitUntil: "domcontentloaded" });
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  const loginForm = page.locator("form").filter({
    has: page.locator("#login-email"),
  });

  await Promise.all([
    page.waitForURL(/\/(home|employeeHome)(?:\?|$)/, { timeout: 30_000 }).catch(
      () => null
    ),
    loginForm.getByRole("button", { name: /^Login$/ }).click(),
  ]);

  const currentUrl = page.url();
  const needsPasswordSetup = await page
    .getByRole("heading", { name: /Set permanent password/i })
    .isVisible()
    .catch(() => false);

  return {
    ok: /\/(home|employeeHome)(?:\?|$)/.test(currentUrl),
    currentUrl,
    needsPasswordSetup,
  };
}

async function inspectPageState(page: Page) {
  const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(
    () => ""
  );
  const hasCustomNotFoundHeading = await page
    .getByRole("heading", { name: /^Page Not Found$/i })
    .isVisible()
    .catch(() => false);

  if (/This page could not be found/i.test(bodyText) || hasCustomNotFoundHeading) {
    return { pageState: "not-found" as const, details: "Page body indicates a 404." };
  }

  if (/Application error|Something went wrong|Unhandled Runtime Error/i.test(bodyText)) {
    return { pageState: "error" as const, details: "Page body indicates a runtime error." };
  }

  return { pageState: "ok" as const, details: undefined };
}

async function auditBrowserRoute(page: Page, route: string, report: AuditReport) {
  const existingResult = report.routes.find((item) => item.route === route);
  const source = existingResult?.source ?? "hrms-module";
  const result: RouteAuditResult = existingResult ?? {
    route,
    source,
    staticPageExists: routeHasPage(route),
  };

  try {
    const response = await page.goto(toAbsoluteUrl(route), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => null);

    const inspected = await inspectPageState(page);
    result.statusCode = response?.status() ?? null;
    result.finalUrl = page.url();
    result.pageState =
      response?.status() === 404 ? "not-found" : inspected.pageState;
    result.details = inspected.details;

    if ((result.statusCode ?? 200) >= 400 || result.pageState !== "ok") {
      addIssue(report, {
        severity: "error",
        area: "Browser route audit",
        title: `Route failed to load cleanly: ${route}`,
        details: `Status ${result.statusCode ?? "unknown"}; state ${result.pageState}. ${result.details ?? ""}`.trim(),
      });
    }
  } catch (error) {
    result.statusCode = null;
    result.finalUrl = page.url();
    result.pageState = "unknown";
    result.details = error instanceof Error ? error.message : String(error);
    addIssue(report, {
      severity: "error",
      area: "Browser route audit",
      title: `Route could not be audited: ${route}`,
      details: result.details,
    });
  }

  if (!existingResult) {
    report.routes.push(result);
  } else {
    Object.assign(existingResult, result);
  }
}

async function auditAdminRoutes(page: Page, routes: string[], report: AuditReport) {
  const uniqueRoutes = [...new Set([...ADMIN_MODULE_ROUTES, ...routes])].filter((route) =>
    routeHasPage(route)
  );

  for (const route of uniqueRoutes) {
    await auditBrowserRoute(page, route, report);
  }

  const failures = report.routes.filter((route) => {
    return route.source !== "employee-header" && route.pageState && route.pageState !== "ok";
  });

  addCheck(report, {
    name: "Admin browser route audit",
    status: failures.length > 0 ? "fail" : "pass",
    details: `${uniqueRoutes.length} admin route(s) opened in the browser.`,
  });
}

async function openPayrollTab(page: Page, tabName: string, report: AuditReport) {
  try {
    await page.getByRole("tab", { name: tabName }).click({ timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => null);
    addCheck(report, {
      name: `Payroll tab: ${tabName}`,
      status: "pass",
      details: "Tab opened without a browser exception.",
    });
  } catch (error) {
    addIssue(report, {
      severity: "error",
      area: "Payroll workspace",
      title: `Payroll tab could not open: ${tabName}`,
      details: error instanceof Error ? error.message : String(error),
    });
    addCheck(report, {
      name: `Payroll tab: ${tabName}`,
      status: "fail",
    });
  }
}

async function runPayrollDraftSimulation(page: Page, report: AuditReport) {
  const year = report.payrollYear;
  let seededPeriods = false;
  let dbAudit =
    report.dbAudit ?? (await tryCollectDbAudit(report, year, "Payroll DB readiness"));

  if (!dbAudit) {
    const details =
      "Skipped payroll simulation because the audit could not read DATABASE_URL-backed payroll readiness data.";
    report.payrollSimulation = {
      status: "skip",
      seededPeriods,
      details,
    };
    addCheck(report, { name: "Payroll draft simulation", status: "skip", details });
    return;
  }

  await page.goto(toAbsoluteUrl(`/payroll?year=${year}`), {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => null);

  if (dbAudit.payroll.periodsForYear === 0) {
    const seedButton = page.getByRole("button", { name: /Seed Periods|Seeding/i });
    try {
      await seedButton.click({ timeout: 10_000 });
      seededPeriods = true;
      await expect
        .poll(async () => (await collectDbAudit(year)).payroll.periodsForYear, {
          timeout: 60_000,
        })
        .toBeGreaterThan(0);
      dbAudit = await collectDbAudit(year);
      report.dbAudit = dbAudit;
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      addIssue(report, {
        severity: "error",
        area: "Payroll simulation",
        title: "Unable to seed payroll periods from the UI",
        details,
      });
      report.payrollSimulation = {
        status: "fail",
        seededPeriods,
        details,
      };
      return;
    }
  }

  if (dbAudit.employeeReadiness.payrollEligibleEmployeeCount === 0) {
    const details = "Skipped compute because no semi-monthly payroll-eligible employees exist.";
    report.payrollSimulation = {
      status: "skip",
      seededPeriods,
      details,
    };
    addCheck(report, { name: "Payroll draft simulation", status: "skip", details });
    return;
  }

  const safePeriod = dbAudit.payroll.safeDraftPeriod;
  if (!safePeriod) {
    const details =
      "Skipped compute because every payroll period has a latest run status outside Draft, Stale, Void, or no-run.";
    report.payrollSimulation = {
      status: "skip",
      seededPeriods,
      details,
    };
    addIssue(report, {
      severity: "warning",
      area: "Payroll simulation",
      title: "No draft-safe payroll period is available",
      details,
    });
    addCheck(report, { name: "Payroll draft simulation", status: "skip", details });
    return;
  }

  await page.goto(toAbsoluteUrl(`/payroll?year=${year}&periodId=${safePeriod.id}`), {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => null);

  const computeButton = page
    .getByRole("button", {
      name: /Compute \/ Recompute Run|Create New Draft Run|Computing/i,
    })
    .first();

  try {
    await computeButton.click({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /Computing/i }),
      "Payroll compute should finish and leave draft-only mode."
    ).toHaveCount(0, { timeout: 120_000 });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    addIssue(report, {
      severity: "error",
      area: "Payroll simulation",
      title: "Draft payroll compute failed from the UI",
      details,
    });
    report.payrollSimulation = {
      status: "fail",
      seededPeriods,
      selectedPeriod: safePeriod,
      details,
    };
    addCheck(report, { name: "Payroll draft simulation", status: "fail", details });
    return;
  }

  let latestRun: Awaited<ReturnType<typeof getLatestPayrollRunSummary>> = null;
  try {
    latestRun = await getLatestPayrollRunSummary(safePeriod.id);
  } catch (error) {
    addIssue(report, {
      severity: "error",
      area: "Payroll simulation",
      title: "Unable to read latest payroll run after compute",
      details: error instanceof Error ? error.message : String(error),
    });
  }

  if (!latestRun) {
    addIssue(report, {
      severity: "error",
      area: "Payroll simulation",
      title: "Compute finished but no payroll run was found",
      details: `Selected period: ${safePeriod.code}.`,
    });
  } else if (latestRun.status !== "Draft") {
    addIssue(report, {
      severity: "error",
      area: "Payroll simulation",
      title: "Compute produced a non-draft latest run",
      details: `Run #${latestRun.runNumber} ended with status ${latestRun.status}.`,
    });
  } else if (latestRun.employeeRows === 0) {
    addIssue(report, {
      severity: "warning",
      area: "Payroll simulation",
      title: "Draft payroll run has no employee rows",
      details:
        "The run was created, but no employee payroll snapshots were produced. Check employee salary, payroll terms, manual payroll overrides, and separation dates.",
    });
  }

  for (const buttonName of ["Review", "Approve", "Post"]) {
    const exists = await page
      .getByRole("button", { name: new RegExp(`^${buttonName}$`) })
      .isVisible()
      .catch(() => false);

    if (!exists) {
      addIssue(report, {
        severity: "warning",
        area: "Payroll workflow controls",
        title: `${buttonName} button is not visible in the Payroll Run tab`,
        details:
          "The audit verifies workflow controls but does not click Review, Approve, or Post.",
      });
    }
  }

  await openPayrollTab(page, "Manual Payroll", report);
  await openPayrollTab(page, "Reports", report);
  await openPayrollTab(page, "Attendance Imports", report);
  await openPayrollTab(page, "Payroll Account Code", report);
  await openPayrollTab(page, "Payroll Run", report);

  report.payrollSimulation = {
    status: latestRun?.status === "Draft" ? "pass" : "warn",
    seededPeriods,
    selectedPeriod: safePeriod,
    latestRun,
    details: latestRun
      ? `Run #${latestRun.runNumber} is ${latestRun.status} with ${latestRun.employeeRows} employee row(s).`
      : "No latest run found after compute.",
  };
  addCheck(report, {
    name: "Payroll draft simulation",
    status: latestRun?.status === "Draft" ? "pass" : "warn",
    details: report.payrollSimulation.details,
  });
}

async function runEmployeePortalAudit(
  browser: Browser,
  employeeRoutes: string[],
  report: AuditReport
) {
  const employeeEmail = process.env.PLAYWRIGHT_EMPLOYEE_EMAIL;
  const employeePassword = process.env.PLAYWRIGHT_EMPLOYEE_PASSWORD;

  if (!employeeEmail || !employeePassword) {
    addCheck(report, {
      name: "Employee portal browser audit",
      status: "skip",
      details:
        "Set PLAYWRIGHT_EMPLOYEE_EMAIL and PLAYWRIGHT_EMPLOYEE_PASSWORD to simulate employee-side pages.",
    });
    return;
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const loginResult = await login(page, employeeEmail, employeePassword);
    if (!loginResult.ok || !/\/employeeHome(?:\?|$)/.test(loginResult.currentUrl)) {
      addIssue(report, {
        severity: "error",
        area: "Employee login",
        title: "Employee login did not reach employee home",
        details: `Final URL: ${loginResult.currentUrl}`,
      });
      addCheck(report, {
        name: "Employee portal browser audit",
        status: "fail",
        details: "Employee login failed or reached the wrong role home.",
      });
      return;
    }

    for (const route of employeeRoutes) {
      await auditBrowserRoute(page, route, report);
    }

    addCheck(report, {
      name: "Employee portal browser audit",
      status: "pass",
      details: `${employeeRoutes.length} employee route(s) opened in the browser.`,
    });
  } finally {
    await context.close();
  }
}

function renderIssue(issue: AuditIssue) {
  const evidence = issue.evidence?.length
    ? ` Evidence: ${issue.evidence.join("; ")}`
    : "";
  return `- ${issue.severity.toUpperCase()} [${issue.area}] ${issue.title}${
    issue.details ? ` - ${issue.details}` : ""
  }${evidence}`;
}

function renderMarkdown(report: AuditReport) {
  updateSummary(report);

  const lines = [
    "# HRMS Audit Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Base URL: ${report.baseURL}`,
    `Mode: ${report.mode}`,
    `Payroll year: ${report.payrollYear}`,
    "",
    "## Summary",
    "",
    `- Errors: ${report.summary.errors}`,
    `- Warnings: ${report.summary.warnings}`,
    `- Info: ${report.summary.info}`,
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
    "## Missing Items And Findings",
    "",
    ...(report.issues.length > 0
      ? report.issues.map(renderIssue)
      : ["No missing items or workflow failures were detected."]),
    "",
    "## Database Snapshot",
    "",
    report.dbAudit
      ? [
          `- Active admins: ${report.dbAudit.counts.activeAdminAccounts}`,
          `- Active employees: ${report.dbAudit.employeeReadiness.activeEmployeeCount}`,
          `- Payroll-eligible employees: ${report.dbAudit.employeeReadiness.payrollEligibleEmployeeCount}`,
          `- Payroll periods for ${report.payrollYear}: ${report.dbAudit.payroll.periodsForYear}`,
          `- Safe draft period: ${
            report.dbAudit.payroll.safeDraftPeriod?.code ?? "none"
          }`,
        ].join("\n")
      : "Database audit was not completed.",
    "",
    "## Payroll Simulation",
    "",
    report.payrollSimulation
      ? [
          `- Status: ${report.payrollSimulation.status}`,
          `- Seeded periods: ${report.payrollSimulation.seededPeriods ? "yes" : "no"}`,
          `- Details: ${report.payrollSimulation.details}`,
        ].join("\n")
      : "Payroll simulation was not completed.",
    "",
    "## Route Audit",
    "",
    ...report.routes.map((route) => {
      const browserState = route.pageState ? `, browser: ${route.pageState}` : "";
      const status = route.statusCode ? `, status: ${route.statusCode}` : "";
      return `- ${route.route} (${route.source}) - static: ${
        route.staticPageExists ? "yes" : "no"
      }${browserState}${status}`;
    }),
    "",
  ];

  return lines.join("\n");
}

async function writeAuditReport(report: AuditReport, testInfo: { attach: any }) {
  updateSummary(report);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2));
  fs.writeFileSync(REPORT_MD_PATH, renderMarkdown(report));

  await testInfo.attach("hrms-audit.json", {
    path: REPORT_JSON_PATH,
    contentType: "application/json",
  });
  await testInfo.attach("hrms-audit.md", {
    path: REPORT_MD_PATH,
    contentType: "text/markdown",
  });
}

test.describe.configure({ mode: "serial" });

test("simulates and audits the HRMS in draft-only mode", async ({
  page,
  browser,
}, testInfo) => {
  const report = createReport();
  let unexpectedError: unknown = null;

  try {
    const staticRoutes = collectStaticRouteAudit(report);

    const dbAudit = await tryCollectDbAudit(report, report.payrollYear);
    if (dbAudit) {
      report.dbAudit = dbAudit;
      addDbReadinessIssues(report, dbAudit);
    }

    const adminEmail = process.env.PLAYWRIGHT_ADMIN_EMAIL;
    const adminPassword = process.env.PLAYWRIGHT_ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      addIssue(report, {
        severity: "error",
        area: "Configuration",
        title: "Missing Playwright admin credentials",
        details:
          "Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD before running the HRMS audit.",
      });
      addCheck(report, {
        name: "Admin login",
        status: "fail",
        details: "Required environment variables are missing.",
      });
    } else {
      const adminLoginResult = await login(page, adminEmail, adminPassword);
      if (!adminLoginResult.ok || !/\/home(?:\?|$)/.test(adminLoginResult.currentUrl)) {
        addIssue(report, {
          severity: "error",
          area: "Admin login",
          title: "Admin login did not reach admin home",
          details: adminLoginResult.needsPasswordSetup
            ? "The account accepted a temporary password and is asking to set a permanent password. The audit will not mutate credentials."
            : `Final URL: ${adminLoginResult.currentUrl}`,
        });
        addCheck(report, {
          name: "Admin login",
          status: "fail",
          details: "Browser workflow cannot continue without an admin session.",
        });
      } else {
        addCheck(report, {
          name: "Admin login",
          status: "pass",
          details: `Logged in and reached ${adminLoginResult.currentUrl}.`,
        });

        await auditAdminRoutes(page, staticRoutes.adminHeaderRoutes, report);
        await runPayrollDraftSimulation(page, report);
        await runEmployeePortalAudit(browser, staticRoutes.employeeHeaderRoutes, report);
      }
    }
  } catch (error) {
    unexpectedError = error;
    addIssue(report, {
      severity: "error",
      area: "Audit harness",
      title: "The audit harness stopped unexpectedly",
      details: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  } finally {
    await writeAuditReport(report, testInfo);
  }

  if (unexpectedError) {
    throw unexpectedError;
  }

  const fatalIssues = report.issues.filter((issue) => issue.severity === "error");
  expect(fatalIssues.map(renderIssue)).toEqual([]);
});
