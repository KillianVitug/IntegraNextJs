import { ATTENDANCE_DTR_WORKED_MINUTES_PER_PRESENT_DAY } from "./dtrOverrides";

export type BranchCalendarAccountCodeOverrideLike = {
  attendanceDate: string;
  departmentId: number | null;
  regularAccountCodeId: number;
  overtimeAccountCodeId: number;
};

export type BranchCalendarAttendanceRowLike = {
  attendanceDate: string;
  workedMinutes: number;
  regularMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
  isRestDay: boolean;
};

export type BranchCalendarHeldApprovalMinuteRow = {
  attendanceDate: string;
  workedMinutes: number;
  overtimeMinutes: number;
};

export type BranchCalendarGeneratedDtrRow<TAccount> = {
  attendanceDate: string;
  regularAccount: TAccount;
  overtimeAccount: TAccount;
  regularMinutes: number;
  overtimeMinutes: number;
};

export function buildBranchCalendarOverrideScopeMaps<
  TOverride extends BranchCalendarAccountCodeOverrideLike,
>(rows: TOverride[]) {
  return {
    allDepartmentsByDate: new Map(
      rows
        .filter((row) => row.departmentId == null)
        .map((row) => [row.attendanceDate, row] as const)
    ),
    departmentByDateScope: new Map(
      rows
        .filter((row) => row.departmentId != null)
        .map((row) => [`${row.attendanceDate}:${row.departmentId}`, row] as const)
    ),
  };
}

export function getEffectiveBranchCalendarOverride<
  TOverride extends BranchCalendarAccountCodeOverrideLike,
>(args: {
  attendanceDate: string;
  departmentId: number | null | undefined;
  maps: ReturnType<typeof buildBranchCalendarOverrideScopeMaps<TOverride>>;
}) {
  const departmentOverride =
    args.departmentId != null
      ? args.maps.departmentByDateScope.get(
          `${args.attendanceDate}:${args.departmentId}`
        )
      : null;

  return (
    departmentOverride ??
    args.maps.allDepartmentsByDate.get(args.attendanceDate) ??
    null
  );
}

export function getBranchCalendarRegularMinutes(
  row: Pick<
    BranchCalendarAttendanceRowLike,
    | "workedMinutes"
    | "regularMinutes"
    | "lateMinutes"
    | "undertimeMinutes"
    | "isRestDay"
  >
) {
  if (row.isRestDay || (row.workedMinutes <= 0 && row.regularMinutes <= 0)) {
    return 0;
  }

  return Math.max(
    0,
    ATTENDANCE_DTR_WORKED_MINUTES_PER_PRESENT_DAY -
      Math.max(0, Math.round(row.lateMinutes)) -
      Math.max(0, Math.round(row.undertimeMinutes))
  );
}

export function buildBranchCalendarOverrideRowsForGeneratedDtr<
  TOverride extends BranchCalendarAccountCodeOverrideLike,
  TAccount extends { id: number },
>(args: {
  rows: BranchCalendarAttendanceRowLike[];
  departmentId: number | null | undefined;
  overrideMaps: ReturnType<typeof buildBranchCalendarOverrideScopeMaps<TOverride>>;
  accountById: Map<number, TAccount>;
  isBranchCalendarDateEligible?: (row: BranchCalendarAttendanceRowLike) => boolean;
}) {
  const branchRows: Array<BranchCalendarGeneratedDtrRow<TAccount>> = [];

  for (const row of args.rows) {
    if (row.isRestDay) continue;
    if (args.isBranchCalendarDateEligible?.(row) === false) continue;

    const override = getEffectiveBranchCalendarOverride({
      attendanceDate: row.attendanceDate,
      departmentId: args.departmentId,
      maps: args.overrideMaps,
    });
    if (!override) continue;

    const regularAccount = args.accountById.get(override.regularAccountCodeId);
    const overtimeAccount = args.accountById.get(override.overtimeAccountCodeId);
    if (!regularAccount || !overtimeAccount) continue;

    const regularMinutes = getBranchCalendarRegularMinutes(row);
    const overtimeMinutes = Math.max(0, Math.round(row.overtimeMinutes));
    if (regularMinutes <= 0 && overtimeMinutes <= 0) continue;

    branchRows.push({
      attendanceDate: row.attendanceDate,
      regularAccount,
      overtimeAccount,
      regularMinutes,
      overtimeMinutes,
    });
  }

  return branchRows;
}

export function splitHeldDtrBranchCalendarApprovalMinutes<
  TApproval extends BranchCalendarHeldApprovalMinuteRow,
  TOverride extends BranchCalendarAccountCodeOverrideLike,
  TAccount extends { id: number },
>(args: {
  approvalRows: TApproval[];
  departmentId: number | null | undefined;
  overrideMaps: ReturnType<typeof buildBranchCalendarOverrideScopeMaps<TOverride>>;
  accountById: Map<number, TAccount>;
  isBranchCalendarDateEligible?: (row: TApproval) => boolean;
}) {
  const branchRows: Array<BranchCalendarGeneratedDtrRow<TAccount>> = [];
  const fallbackWorkedRows: Array<TApproval & { quantityMinutes: number }> = [];
  const fallbackOvertimeRows: Array<TApproval & { quantityMinutes: number }> = [];

  for (const approval of args.approvalRows) {
    const workedMinutes = Math.max(0, Math.round(approval.workedMinutes));
    const overtimeMinutes = Math.max(0, Math.round(approval.overtimeMinutes));
    if (workedMinutes <= 0 && overtimeMinutes <= 0) continue;

    const override =
      args.isBranchCalendarDateEligible?.(approval) === false
        ? null
        : getEffectiveBranchCalendarOverride({
            attendanceDate: approval.attendanceDate,
            departmentId: args.departmentId,
            maps: args.overrideMaps,
          });
    const regularAccount =
      override != null ? args.accountById.get(override.regularAccountCodeId) : null;
    const overtimeAccount =
      override != null ? args.accountById.get(override.overtimeAccountCodeId) : null;

    if (override && regularAccount && overtimeAccount) {
      branchRows.push({
        attendanceDate: approval.attendanceDate,
        regularAccount,
        overtimeAccount,
        regularMinutes: workedMinutes,
        overtimeMinutes,
      });
      continue;
    }

    if (workedMinutes > 0) {
      fallbackWorkedRows.push({ ...approval, quantityMinutes: workedMinutes });
    }

    if (overtimeMinutes > 0) {
      fallbackOvertimeRows.push({ ...approval, quantityMinutes: overtimeMinutes });
    }
  }

  return {
    branchRows,
    fallbackWorkedRows,
    fallbackOvertimeRows,
  };
}
