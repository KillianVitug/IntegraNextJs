"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getPayrollReportBundleAction } from "@/app/actions/payrollAction";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  formatEmployeeNoDisplay,
  getEmployeeTypeDisplay,
  sortEmployeesByLastName,
} from "@/utils/employeeDisplay";
import { PayrollPageNav } from "../PayrollPageNav";
import type {
  PayrollAccountCodeReportOptionView,
  PayrollAgencySummaryView,
  PayrollContributionReportRowView,
  PayrollDepartmentReportRowView,
  PayrollLineReportRowView,
  PayrollNetPayReportRowView,
  PayrollPeriodSummary,
  PayrollRegisterReportView,
  PayrollReportType,
  PayrollRunEmployeeView,
  PayrollRunLineView,
  PayrollRunView,
} from "../types";

type LoadStatus = "idle" | "loading" | "ready" | "error";

type ReportState = {
  status: LoadStatus;
  runId: string | null;
  register: PayrollRegisterReportView | null;
  agencySummary: PayrollAgencySummaryView | null;
  error: string | null;
};

type Props = {
  selectedYear: number;
  selectedPeriod: PayrollPeriodSummary | null;
  selectedRun: PayrollRunView | null;
};

const EMPTY_AGENCY_SUMMARY: PayrollAgencySummaryView = {
  sssEmployee: "0",
  philhealthEmployee: "0",
  pagibigEmployee: "0",
  withholdingTax: "0",
  sssEmployer: "0",
  sssEc: "0",
  philhealthEmployer: "0",
  pagibigEmployer: "0",
};

const PAYROLL_REPORT_OPTIONS: Array<{
  value: PayrollReportType;
  label: string;
  description: string;
}> = [
  {
    value: "department",
    label: "Department Report",
    description: "Gross, deduction, contribution, and net pay by department.",
  },
  { value: "netPay", label: "Net Pay Report", description: "Employee net pay register." },
  { value: "allowance", label: "Allowance Report", description: "Allowance and COLA lines." },
  { value: "deduction", label: "Deduction Report", description: "Non-contribution deduction lines." },
  { value: "contribution", label: "Contribution Report", description: "Government and tax contribution lines." },
  { value: "accountCode", label: "Account Code Report", description: "Payroll lines grouped by account code." },
];

const ALLOWANCE_REPORT_CODES = new Set(["M-ALLOW", "D-ALLOW", "COLA"]);
const CONTRIBUTION_REPORT_CODES = new Set([
  "SSS",
  "SSS-EE",
  "SSS-ER",
  "SSS-EC",
  "PHILHEALTH",
  "PHILHEALTH-ER",
  "PHIC-EE",
  "PHIC-ER",
  "PAGIBIG",
  "PAGIBIG-ER",
  "HDMF-EE",
  "HDMF-ER",
  "PERAA",
  "PERAA-ER",
  "TAX",
  "WHT",
]);

const moneyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

function toNumber(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: string | number | null | undefined) {
  return moneyFormatter.format(toNumber(value));
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getToneClass(status: string | null | undefined) {
  if (status === "Posted" || status === "Processed" || status === "Approved") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (status === "Draft" || status === "Reviewed") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  }
  if (status === "Void" || status === "Reversed" || status === "Failed") {
    return "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
  }
  return "bg-muted text-muted-foreground";
}

function buildRunSummaryFromEmployees(employees: PayrollRunEmployeeView[]) {
  return employees.reduce(
    (summary, employee) => ({
      grossPay: summary.grossPay + toNumber(employee.grossPay),
      totalDeductions: summary.totalDeductions + toNumber(employee.totalDeductions),
      netPay: summary.netPay + toNumber(employee.netPay),
      employerContributions:
        summary.employerContributions + toNumber(employee.employerContributions),
    }),
    { grossPay: 0, totalDeductions: 0, netPay: 0, employerContributions: 0 }
  );
}

function buildDepartmentReportRows(
  employees: PayrollRunEmployeeView[]
): PayrollDepartmentReportRowView[] {
  const rows = new Map<string, PayrollDepartmentReportRowView>();

  for (const employee of employees) {
    const key = employee.departmentId == null ? "unassigned" : String(employee.departmentId);
    const row =
      rows.get(key) ??
      ({
        key,
        departmentId: employee.departmentId,
        departmentName: employee.departmentName ?? "Unassigned",
        departmentCode: employee.departmentCode,
        employeeCount: 0,
        grossPay: 0,
        totalDeductions: 0,
        employeeContributions: 0,
        employerContributions: 0,
        netPay: 0,
      } satisfies PayrollDepartmentReportRowView);

    row.employeeCount += 1;
    row.grossPay += toNumber(employee.grossPay);
    row.totalDeductions += toNumber(employee.totalDeductions);
    row.employeeContributions += toNumber(employee.employeeContributions);
    row.employerContributions += toNumber(employee.employerContributions);
    row.netPay += toNumber(employee.netPay);
    rows.set(key, row);
  }

  return [...rows.values()].sort((left, right) =>
    left.departmentName.localeCompare(right.departmentName)
  );
}

function buildNetPayReportRows(
  employees: PayrollRunEmployeeView[]
): PayrollNetPayReportRowView[] {
  return employees.map((employee) => ({
    employeeId: employee.employeeId,
    employeeNo: employee.employeeNoSnapshot,
    employeeType:
      getEmployeeTypeDisplay({ employeeNo: employee.employeeNoSnapshot }) || null,
    employeeName: employee.employeeNameSnapshot,
    departmentName: employee.departmentName,
    departmentCode: employee.departmentCode,
    grossPay: employee.grossPay,
    totalDeductions: employee.totalDeductions,
    employeeContributions: employee.employeeContributions,
    employerContributions: employee.employerContributions,
    netPay: employee.netPay,
  }));
}

function isContributionReportLine(line: PayrollRunLineView) {
  return (
    line.lineType === "Deduction" &&
    (CONTRIBUTION_REPORT_CODES.has(line.code) ||
      /sss|philhealth|pag-?ibig|withholding|tax/i.test(
        `${line.code} ${line.description}`
      ))
  );
}

function isAllowanceReportLine(line: PayrollRunLineView) {
  return (
    line.lineType === "Earning" &&
    (ALLOWANCE_REPORT_CODES.has(line.code) ||
      /allowance|cola/i.test(`${line.code} ${line.description}`))
  );
}

function isDeductionReportLine(line: PayrollRunLineView) {
  return line.lineType === "Deduction" && !isContributionReportLine(line);
}

function buildLineReportRows(
  employees: PayrollRunEmployeeView[],
  predicate: (line: PayrollRunLineView) => boolean
): PayrollLineReportRowView[] {
  return employees
    .flatMap((employee) =>
      employee.lines.filter(predicate).map((line) => ({
        id: line.id,
        employeeId: employee.employeeId,
        employeeNo: employee.employeeNoSnapshot,
        employeeType:
          getEmployeeTypeDisplay({ employeeNo: employee.employeeNoSnapshot }) ||
          null,
        employeeName: employee.employeeNameSnapshot,
        departmentName: employee.departmentName ?? "Unassigned",
        departmentCode: employee.departmentCode,
        lineType: line.lineType,
        code: line.code,
        description: line.description,
        quantity: line.quantity,
        rate: line.rate,
        amount: line.amount,
        taxable: line.taxable,
        month13thEligible: line.month13thEligible,
        sourceTable: line.sourceTable,
        sourceId: line.sourceId,
      }))
    )
    .sort((left, right) => {
      const byCode = left.code.localeCompare(right.code);
      if (byCode !== 0) return byCode;
      return left.employeeName.localeCompare(right.employeeName);
    });
}

function buildContributionReportRows(
  employees: PayrollRunEmployeeView[]
): PayrollContributionReportRowView[] {
  return employees
    .map((employee) => {
      const lines = employee.lines.filter(isContributionReportLine);
      return {
        employeeId: employee.employeeId,
        employeeNo: employee.employeeNoSnapshot,
        employeeType:
          getEmployeeTypeDisplay({ employeeNo: employee.employeeNoSnapshot }) ||
          null,
        employeeName: employee.employeeNameSnapshot,
        departmentId: employee.departmentId,
        departmentName: employee.departmentName ?? "Unassigned",
        departmentCode: employee.departmentCode,
        pagibig: sumLines(lines, ["PAGIBIG", "HDMF-EE"]),
        pagibigEmployer: sumLines(lines, ["PAGIBIG-ER", "HDMF-ER"]),
        philhealth: sumLines(lines, ["PHILHEALTH", "PHIC-EE"]),
        philhealthEmployer: sumLines(lines, ["PHILHEALTH-ER", "PHIC-ER"]),
        sss: sumLines(lines, ["SSS", "SSS-EE"]),
        sssEmployer: sumLines(lines, ["SSS-ER"]),
        sssEc: sumLines(lines, ["SSS-EC"]),
        peraa: sumLines(lines, ["PERAA"]),
        peraaEmployer: sumLines(lines, ["PERAA-ER"]),
        tax: sumLines(lines, ["TAX", "WHT"]),
        total: lines.reduce((total, line) => total + toNumber(line.amount), 0),
      };
    })
    .filter((row) => row.total !== 0)
    .sort((left, right) => left.employeeName.localeCompare(right.employeeName));
}

function sumLines(lines: PayrollRunLineView[], codes: string[]) {
  return lines
    .filter((line) => codes.includes(line.code))
    .reduce((total, line) => total + toNumber(line.amount), 0);
}

function buildAccountCodeReportOptions(
  rows: PayrollLineReportRowView[]
): PayrollAccountCodeReportOptionView[] {
  const byCode = new Map<
    string,
    PayrollAccountCodeReportOptionView & { employeeIds: Set<string> }
  >();

  for (const row of rows) {
    const option =
      byCode.get(row.code) ??
      ({
        code: row.code,
        description: row.description,
        lineType: row.lineType,
        employeeCount: 0,
        lineCount: 0,
        totalAmount: 0,
        employeeIds: new Set<string>(),
      } satisfies PayrollAccountCodeReportOptionView & { employeeIds: Set<string> });
    option.lineCount += 1;
    option.totalAmount += toNumber(row.amount);
    option.employeeIds.add(row.employeeId);
    option.employeeCount = option.employeeIds.size;
    byCode.set(row.code, option);
  }

  return [...byCode.values()]
    .map((option) => ({
      code: option.code,
      description: option.description,
      lineType: option.lineType,
      employeeCount: option.employeeCount,
      lineCount: option.lineCount,
      totalAmount: option.totalAmount,
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

function formatAccountCodeOption(option: PayrollAccountCodeReportOptionView) {
  return `${option.code}${option.description ? ` - ${option.description}` : ""} - ${formatMoney(
    option.totalAmount
  )}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

export function PayrollReportPageClient({
  selectedYear,
  selectedPeriod,
  selectedRun,
}: Props) {
  const [reportState, setReportState] = useState<ReportState>({
    status: "idle",
    runId: null,
    register: null,
    agencySummary: null,
    error: null,
  });
  const [selectedReportType, setSelectedReportType] =
    useState<PayrollReportType>("department");
  const [selectedAccountCode, setSelectedAccountCode] = useState("");
  const reportCacheRef = useRef<Record<string, ReportState>>({});
  const selectedRunId = selectedRun?.id ?? null;

  useEffect(() => {
    if (!selectedRunId) {
      setReportState({
        status: "idle",
        runId: null,
        register: null,
        agencySummary: null,
        error: null,
      });
      return;
    }

    const cacheKey = `reports:${selectedRunId}`;
    const cached = reportCacheRef.current[cacheKey];
    if (cached) {
      setReportState(cached);
      return;
    }

    let cancelled = false;
    setReportState({
      status: "loading",
      runId: selectedRunId,
      register: null,
      agencySummary: null,
      error: null,
    });

    void (async () => {
      try {
        const { register, agencySummary } =
          await getPayrollReportBundleAction(selectedRunId);
        if (cancelled) return;
        const nextState: ReportState = {
          status: "ready",
          runId: selectedRunId,
          register,
          agencySummary: agencySummary ?? EMPTY_AGENCY_SUMMARY,
          error: null,
        };
        reportCacheRef.current[cacheKey] = nextState;
        setReportState(nextState);
      } catch (error) {
        if (cancelled) return;
        setReportState({
          status: "error",
          runId: selectedRunId,
          register: null,
          agencySummary: null,
          error: getErrorMessage(error, "Unable to load payroll reports."),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  const reportEmployees = useMemo(
    () => sortEmployeesByLastName(reportState.register?.employees ?? []),
    [reportState.register?.employees]
  );
  const summary = useMemo(
    () => buildRunSummaryFromEmployees(reportEmployees),
    [reportEmployees]
  );
  const departmentRows = useMemo(
    () => buildDepartmentReportRows(reportEmployees),
    [reportEmployees]
  );
  const netPayRows = useMemo(
    () => buildNetPayReportRows(reportEmployees),
    [reportEmployees]
  );
  const allowanceRows = useMemo(
    () => buildLineReportRows(reportEmployees, isAllowanceReportLine),
    [reportEmployees]
  );
  const deductionRows = useMemo(
    () => buildLineReportRows(reportEmployees, isDeductionReportLine),
    [reportEmployees]
  );
  const contributionRows = useMemo(
    () => buildContributionReportRows(reportEmployees),
    [reportEmployees]
  );
  const allLineRows = useMemo(
    () => buildLineReportRows(reportEmployees, () => true),
    [reportEmployees]
  );
  const accountCodeOptions = useMemo(
    () => buildAccountCodeReportOptions(allLineRows),
    [allLineRows]
  );
  const accountCodeRows = useMemo(
    () => allLineRows.filter((row) => row.code === selectedAccountCode),
    [allLineRows, selectedAccountCode]
  );
  const reportOption =
    PAYROLL_REPORT_OPTIONS.find((option) => option.value === selectedReportType) ??
    PAYROLL_REPORT_OPTIONS[0];
  const agencySummary = reportState.agencySummary ?? EMPTY_AGENCY_SUMMARY;

  useEffect(() => {
    if (selectedReportType !== "accountCode") return;
    if (accountCodeOptions.length === 0) {
      if (selectedAccountCode) setSelectedAccountCode("");
      return;
    }
    if (
      !selectedAccountCode ||
      !accountCodeOptions.some((option) => option.code === selectedAccountCode)
    ) {
      setSelectedAccountCode(accountCodeOptions[0].code);
    }
  }, [accountCodeOptions, selectedAccountCode, selectedReportType]);

  return (
    <div className="space-y-6">
      <PayrollPageNav
        context={{periodId:selectedPeriod?.id,year:selectedPeriod?.startDate.slice(0,4),runId:selectedRun?.id,group:selectedRun?.payrollGroup??undefined}}
        activeSection="report"
        title="Payroll Report"
        description="Review selected-run department, net pay, allowance, deduction, contribution, account-code, and agency reports."
        periodCode={selectedPeriod?.code}
        runLabel={selectedRun ? `#${selectedRun.runNumber} (${selectedRun.status})` : null}
      />

      {!selectedRun ? (
        <Card>
          <CardContent className="py-10">
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Select or compute a payroll run for {selectedYear} before opening
              payroll reports.
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Selected Run</CardTitle>
              <CardDescription>
                Reports are loaded from stored payroll run snapshots.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4 xl:grid-cols-6">
              <StatCard label="Run" value={`#${selectedRun.runNumber}`} />
              <div className="rounded-lg border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Status
                </div>
                <div className="mt-2">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                      getToneClass(selectedRun.status)
                    )}
                  >
                    {selectedRun.status}
                  </span>
                </div>
              </div>
              <StatCard label="Employees" value={reportEmployees.length} />
              <StatCard label="Gross Pay" value={formatMoney(summary.grossPay)} />
              <StatCard label="Deductions" value={formatMoney(summary.totalDeductions)} />
              <StatCard label="Net Pay" value={formatMoney(summary.netPay)} />
            </CardContent>
          </Card>

          {reportState.status === "loading" ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Loading payroll report data...
              </CardContent>
            </Card>
          ) : reportState.status === "error" ? (
            <Card>
              <CardContent className="py-10">
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                  {reportState.error}
                </div>
              </CardContent>
            </Card>
          ) : reportState.status === "ready" && reportState.register ? (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <CardTitle>{reportOption.label}</CardTitle>
                      <CardDescription>{reportOption.description}</CardDescription>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:w-[560px]">
                      <Select
                        value={selectedReportType}
                        onValueChange={(value) =>
                          setSelectedReportType(value as PayrollReportType)
                        }
                      >
                        <SelectTrigger aria-label="Select payroll report">
                          <SelectValue placeholder="Select report" />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYROLL_REPORT_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {selectedReportType === "accountCode" ? (
                        <Select
                          value={selectedAccountCode}
                          onValueChange={setSelectedAccountCode}
                          disabled={accountCodeOptions.length === 0}
                        >
                          <SelectTrigger aria-label="Select account code">
                            <SelectValue placeholder="Select account code" />
                          </SelectTrigger>
                          <SelectContent>
                            {accountCodeOptions.map((option) => (
                              <SelectItem key={option.code} value={option.code}>
                                {formatAccountCodeOption(option)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {selectedReportType === "department" && (
                    <DepartmentReportTable rows={departmentRows} />
                  )}
                  {selectedReportType === "netPay" && (
                    <NetPayReportTable rows={netPayRows} />
                  )}
                  {selectedReportType === "allowance" && (
                    <LineReportTable rows={allowanceRows} />
                  )}
                  {selectedReportType === "deduction" && (
                    <LineReportTable rows={deductionRows} />
                  )}
                  {selectedReportType === "contribution" && (
                    <ContributionReportTable rows={contributionRows} />
                  )}
                  {selectedReportType === "accountCode" && (
                    <LineReportTable rows={accountCodeRows} />
                  )}
                  <div className="px-6 pb-6 text-xs text-muted-foreground">
                    Run #{reportState.register.runNumber} created{" "}
                    {formatDateTime(reportState.register.createdAt)}
                    {reportState.register.computedAt
                      ? ` and last computed ${formatDateTime(
                          reportState.register.computedAt
                        )}.`
                      : "."}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>Agency Summary</CardTitle>
                  <CardDescription>
                    Government contribution and withholding totals.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatCard label="SSS Employee" value={formatMoney(agencySummary.sssEmployee)} />
                  <StatCard label="SSS Employer" value={formatMoney(agencySummary.sssEmployer)} />
                  <StatCard label="SSS EC" value={formatMoney(agencySummary.sssEc)} />
                  <StatCard label="PhilHealth Employee" value={formatMoney(agencySummary.philhealthEmployee)} />
                  <StatCard label="PhilHealth Employer" value={formatMoney(agencySummary.philhealthEmployer)} />
                  <StatCard label="Pag-IBIG Employee" value={formatMoney(agencySummary.pagibigEmployee)} />
                  <StatCard label="Pag-IBIG Employer" value={formatMoney(agencySummary.pagibigEmployer)} />
                  <StatCard label="Withholding Tax" value={formatMoney(agencySummary.withholdingTax)} />
                </CardContent>
              </Card>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function DepartmentReportTable({ rows }: { rows: PayrollDepartmentReportRowView[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Department</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Employees</TableHead>
            <TableHead>Gross</TableHead>
            <TableHead>Deductions</TableHead>
            <TableHead>Employee Share</TableHead>
            <TableHead>Employer Share</TableHead>
            <TableHead>Net</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="font-medium">{row.departmentName}</TableCell>
              <TableCell>{row.departmentCode ?? "-"}</TableCell>
              <TableCell>{row.employeeCount}</TableCell>
              <TableCell>{formatMoney(row.grossPay)}</TableCell>
              <TableCell>{formatMoney(row.totalDeductions)}</TableCell>
              <TableCell>{formatMoney(row.employeeContributions)}</TableCell>
              <TableCell>{formatMoney(row.employerContributions)}</TableCell>
              <TableCell className="font-semibold">{formatMoney(row.netPay)}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <EmptyRow colSpan={8} />}
        </TableBody>
      </Table>
    </div>
  );
}

function NetPayReportTable({ rows }: { rows: PayrollNetPayReportRowView[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee No</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Gross</TableHead>
            <TableHead>Deductions</TableHead>
            <TableHead>Employee Share</TableHead>
            <TableHead>Employer Share</TableHead>
            <TableHead>Net</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.employeeId}>
              <TableCell>{formatEmployeeNoDisplay(row.employeeNo)}</TableCell>
              <TableCell>{row.employeeType ?? "-"}</TableCell>
              <TableCell className="font-medium">{row.employeeName}</TableCell>
              <TableCell>
                {row.departmentName ?? "Unassigned"}
                {row.departmentCode ? ` (${row.departmentCode})` : ""}
              </TableCell>
              <TableCell>{formatMoney(row.grossPay)}</TableCell>
              <TableCell>{formatMoney(row.totalDeductions)}</TableCell>
              <TableCell>{formatMoney(row.employeeContributions)}</TableCell>
              <TableCell>{formatMoney(row.employerContributions)}</TableCell>
              <TableCell className="font-semibold">{formatMoney(row.netPay)}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <EmptyRow colSpan={9} />}
        </TableBody>
      </Table>
    </div>
  );
}

function LineReportTable({ rows }: { rows: PayrollLineReportRowView[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Employee No</TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Qty</TableHead>
            <TableHead>Rate</TableHead>
            <TableHead>Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.code}</TableCell>
              <TableCell>{row.description}</TableCell>
              <TableCell>{formatEmployeeNoDisplay(row.employeeNo)}</TableCell>
              <TableCell>{row.employeeName}</TableCell>
              <TableCell>{row.departmentName ?? "Unassigned"}</TableCell>
              <TableCell>{row.quantity}</TableCell>
              <TableCell>{formatMoney(row.rate)}</TableCell>
              <TableCell className="font-semibold">{formatMoney(row.amount)}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <EmptyRow colSpan={8} />}
        </TableBody>
      </Table>
    </div>
  );
}

function ContributionReportTable({
  rows,
}: {
  rows: PayrollContributionReportRowView[];
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee No</TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>SSS</TableHead>
            <TableHead>SSS ER</TableHead>
            <TableHead>SSS EC</TableHead>
            <TableHead>PhilHealth</TableHead>
            <TableHead>PHIC ER</TableHead>
            <TableHead>Pag-IBIG</TableHead>
            <TableHead>HDMF ER</TableHead>
            <TableHead>PERAA</TableHead>
            <TableHead>PERAA ER</TableHead>
            <TableHead>Tax</TableHead>
            <TableHead>Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.employeeId}>
              <TableCell>{formatEmployeeNoDisplay(row.employeeNo)}</TableCell>
              <TableCell className="font-medium">{row.employeeName}</TableCell>
              <TableCell>{formatMoney(row.sss)}</TableCell>
              <TableCell>{formatMoney(row.sssEmployer)}</TableCell>
              <TableCell>{formatMoney(row.sssEc)}</TableCell>
              <TableCell>{formatMoney(row.philhealth)}</TableCell>
              <TableCell>{formatMoney(row.philhealthEmployer)}</TableCell>
              <TableCell>{formatMoney(row.pagibig)}</TableCell>
              <TableCell>{formatMoney(row.pagibigEmployer)}</TableCell>
              <TableCell>{formatMoney(row.peraa)}</TableCell>
              <TableCell>{formatMoney(row.peraaEmployer)}</TableCell>
              <TableCell>{formatMoney(row.tax)}</TableCell>
              <TableCell className="font-semibold">{formatMoney(row.total)}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <EmptyRow colSpan={13} />}
        </TableBody>
      </Table>
    </div>
  );
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center text-muted-foreground">
        No rows to show for this report.
      </TableCell>
    </TableRow>
  );
}
