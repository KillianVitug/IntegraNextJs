import type { ShiftBreakSlotKey } from "@/lib/shifts";

export const scheduleWeekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export type ScheduleWeekday = (typeof scheduleWeekdays)[number];
export type ScheduleSnapshot = {
  kind: "shift" | "rest" | "unconfigured";
  shiftTableId: number | null;
  shiftName: string;
  shiftCode: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  breakMinutes: number;
  paidBreakMinutes: number;
  graceMinutes: number;
  hoursPerDay: number;
  isFlexible: boolean;
  breaks: Array<{ slotKey: ShiftBreakSlotKey; label: string; fromTime: string; toTime: string; deduct: boolean; deductHours: number; deductMinutes: number; sortOrder: number }>;
};
export type ScheduleCell = {
  employeeId: string;
  day: string;
  value: string;
  label: string;
  source: string;
  defaultValue: string;
  defaultLabel: string;
  baselineValue: string;
  baselineLabel: string;
  snapshot: ScheduleSnapshot;
  defaultSnapshot: ScheduleSnapshot;
  baselineSnapshot: ScheduleSnapshot;
  latestDefaultSnapshot?: ScheduleSnapshot;
};
export type ScheduleDraft = { id: string; revision: number; cells: ScheduleCell[]; sourceDigest: string; updatedAt: string };
export type ScheduleWorkspace = {
  departments: Array<{ id: number; name: string }>;
  periods: Array<{ id: string; code: string; startDate: string; endDate: string; status: string }>;
  shifts: Array<{ id: number; label: string; checkInTime: string; checkOutTime: string; snapshot: ScheduleSnapshot }>;
  departmentId: number | null;
  periodId: string | null;
  effectiveDate: string;
  employees: Array<{ id: string; employeeNo: string; name: string; weeklyDays: Array<{ weekday: ScheduleWeekday; value: string; label: string }>; weeklyHistory: Array<{ id: number; effectiveFrom: string; effectiveTo: string | null }> }>;
  dates: string[];
  cells: ScheduleCell[];
  draft: ScheduleDraft | null;
  sourceDigest: string;
  weeklyDigest: string;
  history: Array<{ revisionId: string; createdAt: string; actorUserId: string; changedCount: number; changes: Array<{employeeId:string;day:string;before:string;after:string;breaks:ScheduleSnapshot["breaks"]}> }>;
  warnings: string[];
};
export type ScheduleWorkspaceQuery = { departmentId?: number; periodId?: string; effectiveDate?: string; employeeId?: string; day?: string; branchId?: number };
export type SchedulePeriodCommand = {
  requestId: string; departmentId: number; periodId: string; sourceDigest: string; expectedDraftRevision: number | null; expectedDraftId: string | null;
  changes: Array<{ employeeId: string; day: string; value: string }>;
};
export type ScheduleDayRepair = {
  departmentId: number; periodId: string; sourceDigest: string;
  expectedDraftId: string | null; expectedDraftRevision: number | null;
  cell: ScheduleCell; pendingDraftCell: ScheduleCell | null;
  shifts: ScheduleWorkspace["shifts"];
};
export type ScheduleWeeklyCommand = {
  requestId: string; departmentId: number; sourceDigest: string; effectiveFrom: string; effectiveTo: string | null;
  employeeIds: string[]; days: Array<{ weekday: ScheduleWeekday; value: string }>;
};
export type ScheduleArchiveCommand = { requestId: string; departmentId: number; sourceDigest: string; employeeId: string; patternId: number; endDate: string };
export type ScheduleReceipt = { requestId: string; action: "draft_saved" | "confirmed" | "days_confirmed" | "draft_deleted" | "weekly_saved" | "weekly_archived"; message: string; changedCount: number; draftRevision?: number; affectedTargets?: Array<{employeeId:string;day:string}>; affectedPeriodIds?: string[]; summariesRebuilt?: number };
export type ScheduleActionResult = { ok: true; receipt: ScheduleReceipt } | { ok: false; error: string };
