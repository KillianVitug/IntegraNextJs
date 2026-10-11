import type { AttendanceDayInput } from "./attendanceDayInput";
export type ProvisionalGroup = "Daily" | "Monthly";
export type ProvisionalAmounts = { gross: number; deductions: number; net: number; shortfall: number };
export type ProvisionalLineDetails = {
  scope: "day" | "period" | "range";
  workDate?: string;
  startDate?: string;
  endDate?: string;
  dueDate?: string;
  quantityMinutes?: number;
  quantityUnit?: "hours" | "days" | "units";
  actualLateMinutes?: number;
  penaltyMinutes?: number;
  notes: string[];
  projected?: boolean;
  formula?: { quantityMinutes: number; hourlyRate: number };
};
export type ProvisionalLine = { code: string; description: string; lineType: "Earning" | "Deduction" | "Employer Contribution" | "Information"; amount: number; quantity?: number | null; rate?: number | null; details?: ProvisionalLineDetails };
export type ProvisionalDay = {
  attendance?: AttendanceDayInput;
  payrollHold?: boolean;
  review?: {
    eligible: boolean;
    scheduleConfigured: boolean;
    approvedLeave: boolean;
    reviewedNoWork: boolean;
    correctedAt: string | null;
    lateMinutes: number;
    undertimeMinutes: number;
    overtimeMinutes: number;
    overtimeApproved: boolean;
    anomalyFlags: string[];
  };
  date: string; scheduleIn: string | null; scheduleOut: string | null; scheduleSource: string;
  isRestDay: boolean; scheduledMinutes: number; workedMinutes: number; regularMinutes: number;
  firstIn: string | null; lastOut: string | null; punches: string[];
  status: "Recorded" | "Incomplete" | "No work recorded" | "Future" | "In progress" | "Paid leave" | "Rest day" | "Schedule missing" | "Held time";
  warnings: string[];
};
export type ProvisionalEmployee = {
  employeeId: string; employeeNo: string; name: string;
  departmentId: number | null; departmentName: string | null;
  payoutHalf: "A" | "B"; scheduledThisHalf: boolean;
  status: "Available" | "Unavailable" | "No work — ₱0" | "Not scheduled this half";
  recorded: ProvisionalAmounts | null; forecast: ProvisionalAmounts | null;
  recordedLines: ProvisionalLine[]; forecastLines: ProvisionalLine[];
  postedCredits: number; futureScheduledMinutes: number; warnings: string[]; days: ProvisionalDay[];
};
export type ProvisionalPayroll = {
  period: { id: string; code: string; startDate: string; endDate: string; earningMonth: string; status: string };
  group: ProvisionalGroup; asOfDate: string; today: string; generatedAt: string; inputRevision: string;
  forecastAssumption: string; rows: ProvisionalEmployee[];
  totals: { recorded: ProvisionalAmounts; forecast: ProvisionalAmounts; available: number; unavailable: number; notScheduled: number };
  postedRun: { id: string; status: string } | null;
  warnings: string[];
};
export type ProvisionalPayrollQuery = { periodId: string; group: ProvisionalGroup; asOfDate?: string; departmentId?: number; employeeId?: string };
