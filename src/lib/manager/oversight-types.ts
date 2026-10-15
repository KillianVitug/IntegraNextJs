/** Public manager contract. Never add payroll objects, free-form notes or financial fields. */
export type ManagerOverviewQuery = { departmentId?: number; periodId?: string; asOfDate?: string; employeeId?: string };
export type ManagerFindingCode = "hold" | "new-evidence" | "punches" | "schedule" | "rest-work" | "scheduled-no-attendance" | "late" | "overtime" | "corrected" | "partial-leave";
export type ManagerLeaveCoverage = "none" | "full-day" | "partial-day" | "unverified";
export type ManagerFinding = { code: ManagerFindingCode; label: string; needsAction: boolean };
export type ManagerAttendanceDay = {
  date: string;
  phase: "recorded" | "after-cutoff" | "in-progress" | "future" | "outside-employment";
  scheduleIn: string | null; scheduleOut: string | null; scheduleSource: string;
  scheduleConfigured: boolean; isRestDay: boolean;
  /** Explicit confirmed working snapshot on a retained designated rest day; never inferred from legacy clock times. */
  scheduledRestWork?: boolean;
  breaks: Array<{ fromTime: string; toTime: string; requiresPunches: boolean }>;
  scheduledMinutes: number; workedMinutes: number; regularMinutes: number;
  lateMinutes: number; undertimeMinutes: number; overtimeMinutes: number;
  hasTimeOverride: boolean;
  overtimeApprovalOnFile: boolean; approvedLeave: boolean; leaveCoverage: ManagerLeaveCoverage; reviewedNoWork: boolean;
  held: boolean; correctedAt: string | null;
  findings: ManagerFinding[]; needsAction: boolean;
  punches: Array<{ id: string; type: "IN" | "OUT" | "UNSPECIFIED"; at: string; included: boolean; state: "effective" | "pending" | "resolved" | "voided" | "excluded" }>;
};
export type ManagerOverviewEmployee = { employeeId: string; employeeNo: string; name: string; actionDays: number; days: ManagerAttendanceDay[] };
export type ManagerAttendanceOverview = {
  departments: Array<{ id: number; name: string }>;
  departmentId: number | null;
  periods: Array<{ id: string; code: string; startDate: string; endDate: string }>;
  period: { id: string; code: string; startDate: string; endDate: string } | null;
  asOfDate: string; today: string; generatedAt: string;
  freshness: { state: "unknown" | "observed"; lastSourceSeenAt: string | null; message: string };
  employees: ManagerOverviewEmployee[];
  counts: { employees: number; actionDays: number; actionEmployees: number; scheduledNoAttendanceDays: number; punchProblemDays: number; scheduleProblemDays: number; heldDays: number; overtimeDays: number };
  issues: Array<{ employeeId: string; name: string; date: string; code: ManagerFindingCode; label: string }>;
  scopeNotice: string;
};
