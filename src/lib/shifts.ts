export const SHIFT_BREAK_SLOT_DEFINITIONS = [
  {
    slotKey: "mid_break",
    label: "Mid Breaktime",
    required: true,
    category: "regular",
    sortOrder: 1,
  },
  {
    slotKey: "break_1",
    label: "Break Time 1",
    required: false,
    category: "regular",
    sortOrder: 2,
  },
  {
    slotKey: "break_2",
    label: "Break Time 2",
    required: false,
    category: "regular",
    sortOrder: 3,
  },
  {
    slotKey: "break_3",
    label: "Break Time 3",
    required: false,
    category: "regular",
    sortOrder: 4,
  },
  {
    slotKey: "break_4",
    label: "Break Time 4",
    required: false,
    category: "regular",
    sortOrder: 5,
  },
  {
    slotKey: "ot_break_1",
    label: "OT Break 1",
    required: false,
    category: "ot",
    sortOrder: 6,
  },
  {
    slotKey: "ot_break_2",
    label: "OT Break 2",
    required: false,
    category: "ot",
    sortOrder: 7,
  },
] as const;

export type ShiftBreakSlotKey = (typeof SHIFT_BREAK_SLOT_DEFINITIONS)[number]["slotKey"];

export type ShiftBreakInputLike = {
  slotKey: ShiftBreakSlotKey;
  fromTime?: string | null;
  toTime?: string | null;
  deduct?: boolean | null;
  deductHours?: number | string | null;
  deductMinutes?: number | string | null;
};

export type ShiftTableLike = {
  code: string;
  description: string;
  regularStartTime: string;
  regularEndTime: string;
  breaks?: ShiftBreakInputLike[] | null;
};

export type ShiftAssignmentLike = {
  shiftName: string;
  shiftCode?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  breakMinutes?: number | string | null;
  paidBreakMinutes?: number | string | null;
  hoursPerDay?: number | string | null;
};

export type ShiftAssignmentSnapshot = {
  shiftName: string;
  shiftCode: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  breakMinutes: number;
  paidBreakMinutes: number;
  hoursPerDay: number;
};

export type DeductibleRegularBreakWindow = {
  slotKey: ShiftBreakSlotKey;
  fromTime: string;
  toTime: string;
  deductMinutes: number;
};

export type ShiftTableReadModel = {
  id: number;
  code: string;
  description: string;
  regularStartTime: string;
  regularEndTime: string;
  breaks: Array<{
    slotKey: ShiftBreakSlotKey;
    label: string;
    fromTime: string | null;
    toTime: string | null;
    deduct: boolean;
    deductHours: number;
    deductMinutes: number;
    sortOrder: number;
  }>;
  deductibleBreakMinutes: number;
  paidBreakMinutes: number;
  hoursPerDay: number;
};

function toNumber(value: number | string | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizeTimeValue(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 5);
}

export function parseTimeToMinutes(value: string | null | undefined) {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return null;

  const [hours, minutes] = normalized.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export function getShiftBreakSlotDefinition(slotKey: ShiftBreakSlotKey) {
  return SHIFT_BREAK_SLOT_DEFINITIONS.find((definition) => definition.slotKey === slotKey) ?? null;
}

export function buildShiftBreakRows(
  existingBreaks: ShiftBreakInputLike[] | null | undefined
) {
  const bySlot = new Map(
    (existingBreaks ?? []).map((breakRow) => [breakRow.slotKey, breakRow])
  );

  return SHIFT_BREAK_SLOT_DEFINITIONS.map((definition) => {
    const current = bySlot.get(definition.slotKey);

    return {
      slotKey: definition.slotKey,
      label: definition.label,
      fromTime: normalizeTimeValue(current?.fromTime) ?? null,
      toTime: normalizeTimeValue(current?.toTime) ?? null,
      deduct: Boolean(current?.deduct),
      deductHours: Math.max(0, toNumber(current?.deductHours)),
      deductMinutes: Math.max(0, toNumber(current?.deductMinutes)),
      sortOrder: definition.sortOrder,
    };
  });
}

export function getTimeRangeDurationMinutes(
  startTime: string | null | undefined,
  endTime: string | null | undefined
) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (startMinutes == null || endMinutes == null) return null;

  return endMinutes <= startMinutes
    ? endMinutes + 1440 - startMinutes
    : endMinutes - startMinutes;
}

function mapTimeToShiftTimeline(
  timeValue: string | null | undefined,
  shiftStartMinutes: number,
  isOvernight: boolean
) {
  const minutes = parseTimeToMinutes(timeValue);
  if (minutes == null) return null;
  if (isOvernight && minutes < shiftStartMinutes) {
    return minutes + 1440;
  }
  return minutes;
}

function getBreakTimelineWindow(args: {
  fromTime: string | null | undefined;
  toTime: string | null | undefined;
  shiftStartMinutes: number;
  isOvernight: boolean;
}) {
  const fromAbsolute = mapTimeToShiftTimeline(
    args.fromTime,
    args.shiftStartMinutes,
    args.isOvernight
  );
  const toAbsoluteBase = mapTimeToShiftTimeline(
    args.toTime,
    args.shiftStartMinutes,
    args.isOvernight
  );

  if (fromAbsolute == null || toAbsoluteBase == null) return null;

  const toAbsolute =
    toAbsoluteBase <= fromAbsolute ? toAbsoluteBase + 1440 : toAbsoluteBase;

  return {
    fromAbsolute,
    toAbsolute,
    durationMinutes: toAbsolute - fromAbsolute,
  };
}

export function deriveShiftMetricsFromTable(shiftTable: ShiftTableLike) {
  const shiftStartMinutes = parseTimeToMinutes(shiftTable.regularStartTime);
  const shiftEndBase = parseTimeToMinutes(shiftTable.regularEndTime);

  if (shiftStartMinutes == null || shiftEndBase == null) {
    return {
      checkInTime: normalizeTimeValue(shiftTable.regularStartTime),
      checkOutTime: normalizeTimeValue(shiftTable.regularEndTime),
      breakMinutes: 0,
      paidBreakMinutes: 0,
      hoursPerDay: 0,
    };
  }

  const isOvernight = shiftEndBase <= shiftStartMinutes;
  const shiftDurationMinutes = getTimeRangeDurationMinutes(
    shiftTable.regularStartTime,
    shiftTable.regularEndTime
  ) ?? 0;

  let deductibleBreakMinutes = 0;
  let paidBreakMinutes = 0;

  for (const breakRow of buildShiftBreakRows(shiftTable.breaks)) {
    const definition = getShiftBreakSlotDefinition(breakRow.slotKey);
    if (!definition || definition.category !== "regular") continue;
    if (!breakRow.fromTime || !breakRow.toTime) continue;

    const breakWindow = getBreakTimelineWindow({
      fromTime: breakRow.fromTime,
      toTime: breakRow.toTime,
      shiftStartMinutes,
      isOvernight,
    });

    if (!breakWindow) continue;

    const deductedDuration = breakRow.deduct
      ? breakRow.deductHours * 60 + breakRow.deductMinutes
      : 0;

    deductibleBreakMinutes += deductedDuration;
    paidBreakMinutes += Math.max(0, breakWindow.durationMinutes - deductedDuration);
  }

  return {
    checkInTime: normalizeTimeValue(shiftTable.regularStartTime),
    checkOutTime: normalizeTimeValue(shiftTable.regularEndTime),
    breakMinutes: deductibleBreakMinutes,
    paidBreakMinutes,
    hoursPerDay: roundToTwo(
      Math.max(0, shiftDurationMinutes - deductibleBreakMinutes) / 60
    ),
  };
}

export function buildDeductibleRegularBreakWindows(
  existingBreaks: ShiftBreakInputLike[] | null | undefined
) {
  return buildShiftBreakRows(existingBreaks).flatMap((breakRow) => {
    const definition = getShiftBreakSlotDefinition(breakRow.slotKey);
    if (!definition || definition.category !== "regular") return [];
    if (!breakRow.deduct || !breakRow.fromTime || !breakRow.toTime) return [];

    const breakDurationMinutes = getTimeRangeDurationMinutes(
      breakRow.fromTime,
      breakRow.toTime
    );
    const deductMinutes = Math.min(
      Math.max(0, breakRow.deductHours * 60 + breakRow.deductMinutes),
      Math.max(0, breakDurationMinutes ?? 0)
    );

    if (deductMinutes <= 0) {
      return [];
    }

    return [
      {
        slotKey: breakRow.slotKey,
        fromTime: breakRow.fromTime,
        toTime: breakRow.toTime,
        deductMinutes,
      } satisfies DeductibleRegularBreakWindow,
    ];
  });
}

export function buildShiftAssignmentSnapshotFromTable(
  shiftTable: ShiftTableLike
): ShiftAssignmentSnapshot {
  const metrics = deriveShiftMetricsFromTable(shiftTable);

  return {
    shiftName: shiftTable.description,
    shiftCode: shiftTable.code,
    checkInTime: metrics.checkInTime,
    checkOutTime: metrics.checkOutTime,
    breakMinutes: metrics.breakMinutes,
    paidBreakMinutes: metrics.paidBreakMinutes,
    hoursPerDay: metrics.hoursPerDay,
  };
}

export function resolveShiftAssignmentSnapshot(args: {
  assignment: ShiftAssignmentLike;
  shiftTable?: ShiftTableLike | null;
  preferShiftTable?: boolean;
}): ShiftAssignmentSnapshot {
  if (args.shiftTable && args.preferShiftTable) {
    return buildShiftAssignmentSnapshotFromTable(args.shiftTable);
  }

  return {
    shiftName: args.assignment.shiftName,
    shiftCode: args.assignment.shiftCode ?? null,
    checkInTime: normalizeTimeValue(args.assignment.checkInTime),
    checkOutTime: normalizeTimeValue(args.assignment.checkOutTime),
    breakMinutes: toNumber(args.assignment.breakMinutes),
    paidBreakMinutes: toNumber(args.assignment.paidBreakMinutes),
    hoursPerDay: roundToTwo(toNumber(args.assignment.hoursPerDay)),
  };
}

export function buildShiftTableReadModel(args: {
  shiftTable: {
    id: number;
    code: string;
    description: string;
    regularStartTime: string;
    regularEndTime: string;
  };
  breaks: ShiftBreakInputLike[] | null | undefined;
}): ShiftTableReadModel {
  const breaks = buildShiftBreakRows(args.breaks);
  const metrics = deriveShiftMetricsFromTable({
    code: args.shiftTable.code,
    description: args.shiftTable.description,
    regularStartTime: args.shiftTable.regularStartTime,
    regularEndTime: args.shiftTable.regularEndTime,
    breaks,
  });

  return {
    id: args.shiftTable.id,
    code: args.shiftTable.code,
    description: args.shiftTable.description,
    regularStartTime: normalizeTimeValue(args.shiftTable.regularStartTime) ?? "",
    regularEndTime: normalizeTimeValue(args.shiftTable.regularEndTime) ?? "",
    breaks,
    deductibleBreakMinutes: metrics.breakMinutes,
    paidBreakMinutes: metrics.paidBreakMinutes,
    hoursPerDay: metrics.hoursPerDay,
  };
}
