import type { ShiftBreakSlotKey, ShiftCalculationPolicy, ShiftPunchPolicy } from "@/lib/shifts";

export const scheduleWeekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export type ScheduleWeekday = (typeof scheduleWeekdays)[number];
export type ScheduleSnapshot = {
  kind: "shift" | "rest" | "unconfigured";
  /** Working a designated rest day keeps its classification and applicable premiums. */
  designatedRestDay?: boolean;
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
  calculationPolicy?: ShiftCalculationPolicy;
  punchPolicy?: ShiftPunchPolicy;
  breaks: Array<{ slotKey: ShiftBreakSlotKey; label: string; fromTime: string; toTime: string; deduct: boolean; deductHours: number; deductMinutes: number; sortOrder: number; requiresPunches?: boolean }>;
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
  changes: Array<{ employeeId: string; day: string; value: string; customTimes?: { start: string; end: string } }>;
  note?: string;
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
  reuseFromDate?: string; previewDigest?: string;
};
export type ScheduleWeeklyPreviewInput = Omit<ScheduleWeeklyCommand, "requestId" | "previewDigest">;
export type ScheduleWeeklyPreview = {
  sourceDigest: string; previewDigest: string; reuseFromDate?: string; canSave: boolean; blockers: string[];
  employees: Array<{
    employeeId: string; name: string; sourcePatternId: number | null; sourceEffectiveFrom: string | null;
    effectiveFrom: string; effectiveTo: string | null;
    days: Array<{ weekday: ScheduleWeekday; snapshot: ScheduleSnapshot; label: string }>;
    changedDays: number | null; retainedAssignments: Array<{ from: string; to: string | null; kind: "confirmed" | "dated" }>;
    blockers: string[];
  }>;
  /** Known refresh/protection targets, including overnight neighbors; not an unlimited-range day count. */
  affectedEmployeeDays: number; payrollMayChange: boolean;
};
export type ScheduleArchiveCommand = { requestId: string; departmentId: number; sourceDigest: string; employeeId: string; patternId: number; endDate: string };
export type ScheduleReceipt = { requestId: string; action: "draft_saved" | "confirmed" | "days_confirmed" | "draft_deleted" | "weekly_saved" | "weekly_archived" | "schedule_requested"; message: string; changedCount: number; draftRevision?: number; affectedTargets?: Array<{employeeId:string;day:string}>; affectedPeriodIds?: string[]; summariesRebuilt?: number;
  outcome?: "applied" | "pending-review" | "approved" | "denied" | "cancelled";
  reviewRequestId?: string;
  operation?: ScheduleOperationKind;
  note?: string;
  linkedEmployees?: Array<{employeeId:string;day:string}>;
  actorRole?: "ADMIN" | "MANAGER";
  selectedEmployeeIds?: string[];
};
export type ScheduleActionResult = { ok: true; receipt: ScheduleReceipt } | { ok: false; error: string; uncertain?: boolean };

export type ScheduleOperationKind = "adjust" | "cover" | "swap";
export type ScheduleDayOperationCommand = Omit<SchedulePeriodCommand, "changes"> & {
  employeeId: string; day: string; operation: ScheduleOperationKind;
  replacementEmployeeId?: string; value?: string; customTimes?: {start:string;end:string};
};
export type SchedulePendingOperation = {
  version: 1; kind: ScheduleOperationKind; primaryEmployeeId: string; day: string;
  departmentId: number; periodId: string; note?: string;
  cells: Array<{ employeeId:string; day:string; before:ScheduleSnapshot; after:ScheduleSnapshot; defaultSnapshot:ScheduleSnapshot }>;
  linkedEmployees: Array<{employeeId:string;day:string}>;
  requestReasons: string[]; requiresRestReview: boolean;
};
export type ScheduleDayHistoryEntry = {
  id:string; requestId:string; day:string; createdAt:string; actorName:string; actorRole:string;
  before:ScheduleSnapshot; after:ScheduleSnapshot; operation:ScheduleOperationKind;
  /** Only this authenticated actor's bounded schedule note may be returned. */
  note?:string; linkedEmployees:Array<{employeeId:string;day:string}>;
};
export type ScheduleDayHistoryPage = { entries:ScheduleDayHistoryEntry[]; nextCursor:string|null;
  requests:Array<{id:string;operation:ScheduleOperationKind;status:"Pending"|"Approved"|"Denied"|"Cancelled"|"Voided";createdAt:string;decidedAt:string|null;reasons:string[];canCancel:boolean}> };
export type ScheduleDayOperations = ScheduleDayRepair & {
  candidates:Array<{employeeId:string;employeeNo:string;name:string;day:string;snapshot:ScheduleSnapshot;label:string;restrictions:string[];requiresReview:boolean;reviewReasons:string[]}>;
  reviewRequired:boolean; restrictions:string[]; reviewReasons:string[]; history:ScheduleDayHistoryPage;
};
