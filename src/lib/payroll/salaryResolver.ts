import { db, type DbClient } from "@/db";
import {
  employeeSalaryChanges,
  employeesSalary,
  payrollPeriods,
} from "@/db/schema";
import {
  employeeSalaryTabViewSchema,
  type EmployeeSalaryTabView,
} from "@/zod-schemas/employeeSalary";
import type {
  SalaryChangeMode,
  SalarySnapshot,
  SalarySnapshotNullable,
} from "@/zod-schemas/salaryChange";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";

type SalaryField =
  | "dailyRate"
  | "monthlyRate"
  | "monthlyAllowance"
  | "dailyAllowance"
  | "cola"
  | "rateDivisor"
  | "billingRate";
type SalaryRecord = typeof employeesSalary.$inferSelect;
type PayrollPeriodRecord = typeof payrollPeriods.$inferSelect;
type SalaryChangeRecord = typeof employeeSalaryChanges.$inferSelect & {
  payrollPeriod: PayrollPeriodRecord | null;
  endPayrollPeriod?: PayrollPeriodRecord | null;
};
type EmployeeMasterReferencePeriodRecord = Pick<
  PayrollPeriodRecord,
  "id" | "code" | "startDate" | "endDate" | "adjustedPayDate" | "cycle" | "status"
>;
type DbLike = DbClient;

export type ResolvedSalarySource =
  | "Base"
  | "ForwardEffective"
  | "MultiPeriodOverride"
  | "OnePeriodOverride";
export type ResolvedSalaryRecord = Partial<SalaryRecord> &
  Record<SalaryField, string | null>;
export type ResolvedSalaryForPeriod = {
  salary: ResolvedSalaryRecord;
  adjustmentId: number | null;
  adjustmentMode: SalaryChangeMode | null;
  resolvedFrom: ResolvedSalarySource;
};

function decimalToString(value: unknown) {
  if (value == null || value === "") return "0";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    return normalized === "" ? "0" : normalized;
  }
  return "0";
}

export function salaryRecordToSnapshot(
  salary: Partial<SalaryRecord> | null | undefined
): SalarySnapshot {
  return {
    dailyRate: decimalToString(salary?.dailyRate),
    monthlyRate: decimalToString(salary?.monthlyRate),
    monthlyAllowance: decimalToString(salary?.monthlyAllowance),
    dailyAllowance: decimalToString(salary?.dailyAllowance),
    cola: decimalToString(salary?.cola),
    rateDivisor: decimalToString(salary?.rateDivisor),
    billingRate: decimalToString(salary?.billingRate),
  };
}

export function salaryChangeBeforeSnapshot(
  change: Pick<
    typeof employeeSalaryChanges.$inferSelect,
    | "beforeDailyRate"
    | "beforeMonthlyRate"
    | "beforeMonthlyAllowance"
    | "beforeDailyAllowance"
    | "beforeCola"
    | "beforeRateDivisor"
    | "beforeBillingRate"
  >
): SalarySnapshotNullable {
  return {
    dailyRate: change.beforeDailyRate,
    monthlyRate: change.beforeMonthlyRate,
    monthlyAllowance: change.beforeMonthlyAllowance,
    dailyAllowance: change.beforeDailyAllowance,
    cola: change.beforeCola,
    rateDivisor: change.beforeRateDivisor,
    billingRate: change.beforeBillingRate,
  };
}

export function salaryChangeAfterSnapshot(
  change: Pick<
    typeof employeeSalaryChanges.$inferSelect,
    | "afterDailyRate"
    | "afterMonthlyRate"
    | "afterMonthlyAllowance"
    | "afterDailyAllowance"
    | "afterCola"
    | "afterRateDivisor"
    | "afterBillingRate"
  >
): SalarySnapshotNullable {
  return {
    dailyRate: change.afterDailyRate,
    monthlyRate: change.afterMonthlyRate,
    monthlyAllowance: change.afterMonthlyAllowance,
    dailyAllowance: change.afterDailyAllowance,
    cola: change.afterCola,
    rateDivisor: change.afterRateDivisor,
    billingRate: change.afterBillingRate,
  };
}

function applySnapshot(
  baseSalary: Partial<SalaryRecord> | null | undefined,
  snapshot: SalarySnapshotNullable
): ResolvedSalaryRecord {
  const resolved: ResolvedSalaryRecord = {
    ...(baseSalary ?? {}),
    dailyRate: snapshot.dailyRate ?? decimalToString(baseSalary?.dailyRate),
    monthlyRate: snapshot.monthlyRate ?? decimalToString(baseSalary?.monthlyRate),
    monthlyAllowance:
      snapshot.monthlyAllowance ?? decimalToString(baseSalary?.monthlyAllowance),
    dailyAllowance:
      snapshot.dailyAllowance ?? decimalToString(baseSalary?.dailyAllowance),
    cola: snapshot.cola ?? decimalToString(baseSalary?.cola),
    rateDivisor: snapshot.rateDivisor ?? decimalToString(baseSalary?.rateDivisor),
    billingRate: snapshot.billingRate ?? decimalToString(baseSalary?.billingRate),
  };

  return resolved;
}

function compareChangePriority(left: SalaryChangeRecord, right: SalaryChangeRecord) {
  const leftDate = left.payrollPeriod?.startDate ?? "";
  const rightDate = right.payrollPeriod?.startDate ?? "";
  const periodDiff = rightDate.localeCompare(leftDate);
  if (periodDiff !== 0) return periodDiff;

  const createdDiff = right.createdAt.getTime() - left.createdAt.getTime();
  if (createdDiff !== 0) return createdDiff;

  return right.id - left.id;
}

function buildResolvedSalary(args: {
  baseSalary: Partial<SalaryRecord> | null | undefined;
  forwardChange?: SalaryChangeRecord | null;
  multiPeriodChange?: SalaryChangeRecord | null;
  overrideChange?: SalaryChangeRecord | null;
}): ResolvedSalaryForPeriod {
  let resolvedSalary = applySnapshot(args.baseSalary, {
    dailyRate: null,
    monthlyRate: null,
    monthlyAllowance: null,
    dailyAllowance: null,
    cola: null,
    rateDivisor: null,
    billingRate: null,
  });
  let adjustmentId: number | null = null;
  let adjustmentMode: SalaryChangeMode | null = null;
  let resolvedFrom: ResolvedSalarySource = "Base";

  if (args.forwardChange) {
    resolvedSalary = applySnapshot(
      resolvedSalary,
      salaryChangeAfterSnapshot(args.forwardChange)
    );
    adjustmentId = args.forwardChange.id;
    adjustmentMode = args.forwardChange.mode;
    resolvedFrom = "ForwardEffective";
  }

  if (args.multiPeriodChange) {
    resolvedSalary = applySnapshot(
      resolvedSalary,
      salaryChangeAfterSnapshot(args.multiPeriodChange)
    );
    adjustmentId = args.multiPeriodChange.id;
    adjustmentMode = args.multiPeriodChange.mode;
    resolvedFrom = "MultiPeriodOverride";
  }

  if (args.overrideChange) {
    resolvedSalary = applySnapshot(
      resolvedSalary,
      salaryChangeAfterSnapshot(args.overrideChange)
    );
    adjustmentId = args.overrideChange.id;
    adjustmentMode = args.overrideChange.mode;
    resolvedFrom = "OnePeriodOverride";
  }

  return {
    salary: resolvedSalary,
    adjustmentId,
    adjustmentMode,
    resolvedFrom,
  };
}

async function loadActiveForwardChanges(
  database: DbLike,
  employeeIds: string[],
  periodStartDate: string
) {
  const rows = await database.query.employeeSalaryChanges.findMany({
    where: and(
      inArray(employeeSalaryChanges.employeeId, employeeIds),
      eq(employeeSalaryChanges.status, "Active"),
      eq(employeeSalaryChanges.mode, "ForwardEffective")
    ),
    with: {
      payrollPeriod: true,
    },
    orderBy: [desc(employeeSalaryChanges.createdAt), desc(employeeSalaryChanges.id)],
  });

  const latestByEmployee = new Map<string, SalaryChangeRecord>();

  for (const row of rows as SalaryChangeRecord[]) {
    if (!row.payrollPeriod) continue;
    if (row.payrollPeriod.startDate > periodStartDate) continue;

    const existing = latestByEmployee.get(row.employeeId);
    if (!existing || compareChangePriority(row, existing) < 0) {
      latestByEmployee.set(row.employeeId, row);
    }
  }

  return latestByEmployee;
}

async function loadActiveMultiPeriodOverrides(
  database: DbLike,
  employeeIds: string[],
  periodStartDate: string
) {
  const rows = await database.query.employeeSalaryChanges.findMany({
    where: and(
      inArray(employeeSalaryChanges.employeeId, employeeIds),
      eq(employeeSalaryChanges.status, "Active"),
      eq(employeeSalaryChanges.mode, "MultiPeriodOverride")
    ),
    with: {
      payrollPeriod: true,
      endPayrollPeriod: true,
    },
    orderBy: [desc(employeeSalaryChanges.createdAt), desc(employeeSalaryChanges.id)],
  });

  const latestByEmployee = new Map<string, SalaryChangeRecord>();

  for (const row of rows as SalaryChangeRecord[]) {
    if (!row.payrollPeriod || !row.endPayrollPeriod) continue;
    if (row.payrollPeriod.startDate > periodStartDate) continue;
    if (row.endPayrollPeriod.startDate < periodStartDate) continue;

    const existing = latestByEmployee.get(row.employeeId);
    if (!existing || compareChangePriority(row, existing) < 0) {
      latestByEmployee.set(row.employeeId, row);
    }
  }

  return latestByEmployee;
}

async function findEmployeeMasterReferencePeriod(
  database: DbLike
): Promise<EmployeeMasterReferencePeriodRecord | null> {
  const today = new Date().toISOString().slice(0, 10);

  const currentPeriod = await database.query.payrollPeriods.findFirst({
    where: and(
      lte(payrollPeriods.startDate, today),
      gte(payrollPeriods.endDate, today)
    ),
    orderBy: [desc(payrollPeriods.startDate), desc(payrollPeriods.endDate)],
  });

  if (currentPeriod) {
    return currentPeriod;
  }

  const latestPastPeriod = await database.query.payrollPeriods.findFirst({
    where: lte(payrollPeriods.endDate, today),
    orderBy: [desc(payrollPeriods.endDate), desc(payrollPeriods.startDate)],
  });

  if (latestPastPeriod) {
    return latestPastPeriod;
  }

  return (
    (await database.query.payrollPeriods.findFirst({
    orderBy: [asc(payrollPeriods.startDate), asc(payrollPeriods.endDate)],
    })) ?? null
  );
}

export async function resolveEmployeeSalaryForPeriod(
  employeeId: string,
  payrollPeriodId: string,
  database: DbLike = db
): Promise<ResolvedSalaryForPeriod> {
  const [period, baseSalary, overrideChange] = await Promise.all([
    database.query.payrollPeriods.findFirst({
      where: eq(payrollPeriods.id, payrollPeriodId),
    }),
    database.query.employeesSalary.findFirst({
      where: eq(employeesSalary.employeeId, employeeId),
    }),
    database.query.employeeSalaryChanges.findFirst({
      where: and(
        eq(employeeSalaryChanges.employeeId, employeeId),
        eq(employeeSalaryChanges.payrollPeriodId, payrollPeriodId),
        eq(employeeSalaryChanges.status, "Active"),
        eq(employeeSalaryChanges.mode, "OnePeriodOverride")
      ),
      with: {
        payrollPeriod: true,
      },
      orderBy: [desc(employeeSalaryChanges.createdAt), desc(employeeSalaryChanges.id)],
    }),
  ]);

  if (!period) {
    throw new Error("Payroll period not found.");
  }

  const [forwardChanges, multiPeriodOverrides] = await Promise.all([
    loadActiveForwardChanges(database, [employeeId], period.startDate),
    loadActiveMultiPeriodOverrides(database, [employeeId], period.startDate),
  ]);
  return buildResolvedSalary({
    baseSalary,
    forwardChange: forwardChanges.get(employeeId) ?? null,
    multiPeriodChange: multiPeriodOverrides.get(employeeId) ?? null,
    overrideChange: (overrideChange as SalaryChangeRecord | null) ?? null,
  });
}

export async function buildResolvedSalaryByEmployeeId(args: {
  employees: Array<{ id: string; salary: SalaryRecord | null }>;
  period: PayrollPeriodRecord;
  database?: DbLike;
}) {
  const database = args.database ?? db;
  const employeeIds = args.employees.map((employee) => employee.id);
  const resolvedByEmployeeId = new Map<string, ResolvedSalaryForPeriod>();

  if (employeeIds.length === 0) {
    return resolvedByEmployeeId;
  }

  const [overrideRows, forwardRows, multiPeriodRows] = await Promise.all([
    database.query.employeeSalaryChanges.findMany({
      where: and(
        inArray(employeeSalaryChanges.employeeId, employeeIds),
        eq(employeeSalaryChanges.payrollPeriodId, args.period.id),
        eq(employeeSalaryChanges.status, "Active"),
        eq(employeeSalaryChanges.mode, "OnePeriodOverride")
      ),
      with: {
        payrollPeriod: true,
      },
      orderBy: [desc(employeeSalaryChanges.createdAt), desc(employeeSalaryChanges.id)],
    }),
    loadActiveForwardChanges(database, employeeIds, args.period.startDate),
    loadActiveMultiPeriodOverrides(database, employeeIds, args.period.startDate),
  ]);

  const overrideByEmployeeId = new Map<string, SalaryChangeRecord>();
  for (const row of overrideRows as SalaryChangeRecord[]) {
    if (!overrideByEmployeeId.has(row.employeeId)) {
      overrideByEmployeeId.set(row.employeeId, row);
    }
  }

  for (const employee of args.employees) {
    resolvedByEmployeeId.set(
      employee.id,
      buildResolvedSalary({
        baseSalary: employee.salary,
        forwardChange: forwardRows.get(employee.id) ?? null,
        multiPeriodChange: multiPeriodRows.get(employee.id) ?? null,
        overrideChange: overrideByEmployeeId.get(employee.id) ?? null,
      })
    );
  }

  return resolvedByEmployeeId;
}

export async function getEmployeeSalaryTabView(
  employeeId: string,
  database: DbLike = db
): Promise<EmployeeSalaryTabView> {
  const [baseSalary, referencePeriod] = await Promise.all([
    database.query.employeesSalary.findFirst({
      where: eq(employeesSalary.employeeId, employeeId),
    }),
    findEmployeeMasterReferencePeriod(database),
  ]);

  const baseSnapshot = salaryRecordToSnapshot(baseSalary);

  if (!referencePeriod) {
    return employeeSalaryTabViewSchema.parse({
      baseSalary: baseSnapshot,
      effectiveSalary: null,
      effectiveChange: null,
      referencePeriod: null,
    });
  }

  const forwardChanges = await loadActiveForwardChanges(
    database,
    [employeeId],
    referencePeriod.startDate
  );
  const effectiveChange = forwardChanges.get(employeeId) ?? null;

  if (!effectiveChange?.payrollPeriod) {
    return employeeSalaryTabViewSchema.parse({
      baseSalary: baseSnapshot,
      effectiveSalary: null,
      effectiveChange: null,
      referencePeriod,
    });
  }

  const effectiveSalary = salaryRecordToSnapshot(
    applySnapshot(baseSalary, salaryChangeAfterSnapshot(effectiveChange))
  );

  return employeeSalaryTabViewSchema.parse({
    baseSalary: baseSnapshot,
    effectiveSalary,
    effectiveChange: {
      id: effectiveChange.id,
      payrollPeriodId: effectiveChange.payrollPeriodId,
      payrollCode: effectiveChange.payrollPeriod.code,
      periodStartDate: effectiveChange.payrollPeriod.startDate,
      periodEndDate: effectiveChange.payrollPeriod.endDate,
      mode: effectiveChange.mode,
      status: effectiveChange.status,
      reason: effectiveChange.reason,
      notes: effectiveChange.notes ?? null,
      createdAt: effectiveChange.createdAt.toISOString(),
      appliedPermanentAt: effectiveChange.appliedPermanentAt?.toISOString() ?? null,
    },
    referencePeriod,
  });
}
