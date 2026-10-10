export type ShiftCalculationPolicy = "legacy" | "eight_hour_day";
export type ShiftPunchPolicy = "legacy" | "outer" | "split_gaps";

export type ShiftCatalogReceipt = {
  requestId: string;
  action: "created" | "revised" | "archived";
  shiftTableId: number;
  familyId: string;
  version: number;
  archivedAt: string | null;
  message: string;
};

/** Explicit references only; not a count of every historical JSON snapshot. */
export type ShiftCatalogUsage = {
  weeklyDays: number;
  datedAssignments: number;
  pendingRequests: number;
};
