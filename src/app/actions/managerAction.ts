"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  department,
  employeeLeaveApprovalEvents,
  employeeLeaveRecordDays,
  employeeShiftAssignments,
  employeesTimekeeping,
  employeeWeeklyShiftPatterns,
  employees,
  employeesGeneralInfo,
  employeesLeaveRecords,
  leaveTypes,
  managerScheduleChangeRequests,
} from "@/db/schema";
import {
  assertManagerCanAccessEmployee,
  getManagerDepartmentIds,
  requireManager,
} from "@/lib/auth/server";
import {
  ensureDefaultLeaveTypes,
  getEmployeeLeaveBalanceSummary,
  getLeaveTypeByCode,
  replaceLeaveRecordDayDetails,
} from "@/lib/payroll/leave";
import {
  isResolvedScheduleRestDay,
  resolveEmployeeScheduleForDate,
} from "@/lib/payroll/scheduleResolver";
import { upsertEmployeeShiftAssignmentSchema } from "@/zod-schemas/employeeShiftAssignment";
import { leaveFormSchema } from "@/zod-schemas/SickandLeaveSchema";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbLike = typeof db | DbTransaction;

const managerLeaveMutationSchema = leaveFormSchema.omit({
  leaveStatus: true,
}).extend({
  id: z.coerce.number().int().positive().optional(),
});

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD date format.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00`);
    return (
      !Number.isNaN(date.getTime()) &&
      value ===
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
          2,
          "0",
        )}-${String(date.getDate()).padStart(2, "0")}`
    );
  }, "Select a valid date.");

const managerScheduleRequestPayloadSchema =
  upsertEmployeeShiftAssignmentSchema.extend({
    effectiveDates: z.array(dateKeySchema).optional(),
    appliedAssignmentIds: z.array(z.coerce.number().int().positive()).optional(),
  });

const managerScheduleRequestSchema = z.object({
  action: z.enum(["Create", "Update", "Delete"]),
  targetAssignmentId: z.coerce.number().int().positive().optional(),
  payload: managerScheduleRequestPayloadSchema,
  reason: z.string().trim().optional(),
});

const managerScheduleRequestUpdateSchema = z.object({
  requestId: z.string().uuid(),
  payload: managerScheduleRequestPayloadSchema,
  reason: z.string().trim().optional(),
});

const managerScheduleRequestIdSchema = z.object({
  requestId: z.string().uuid(),
});

const managerCalendarMonthSchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

function normalizeLeaveEndDate(value: string | null | undefined) {
  return value && value !== "" ? value : null;
}

async function assertNoApprovedLeaveDateConflict(args: {
  employeeId: string;
  startDate: string;
  endDate?: string | null;
  database?: DbLike;
}) {
  const database = args.database ?? db;
  const endDate = normalizeLeaveEndDate(args.endDate) ?? args.startDate;
  const conflicts = await database
    .select({
      leaveDate: employeeLeaveRecordDays.leaveDate,
    })
    .from(employeeLeaveRecordDays)
    .innerJoin(
      employeesLeaveRecords,
      eq(employeeLeaveRecordDays.leaveRecordId, employeesLeaveRecords.id),
    )
    .where(
      and(
        eq(employeesLeaveRecords.employeeId, args.employeeId),
        eq(employeesLeaveRecords.leaveStatus, "Approved"),
        isNull(employeesLeaveRecords.deletedAt),
        gte(employeeLeaveRecordDays.leaveDate, args.startDate),
        lte(employeeLeaveRecordDays.leaveDate, endDate),
      ),
    )
    .orderBy(asc(employeeLeaveRecordDays.leaveDate))
    .limit(3);

  if (conflicts.length === 0) return;

  const dates = [...new Set(conflicts.map((conflict) => conflict.leaveDate))];
  const dateMessage =
    dates.length === 1 ? dates[0] : `${dates.slice(0, -1).join(", ")} and ${dates[dates.length - 1]}`;

  throw new Error(
    `This employee already has an approved leave on ${dateMessage}. Select a different leave date.`,
  );
}

function normalizeEffectiveDatesForRequest(
  payload: z.infer<typeof managerScheduleRequestPayloadSchema>,
) {
  const effectiveDates = payload.effectiveDates?.length
    ? payload.effectiveDates
    : [payload.effectiveFrom];
  const normalizedDates = [
    ...new Set(effectiveDates.map((date) => dateKeySchema.parse(date))),
  ].sort();

  if (normalizedDates.length === 0) {
    throw new Error("Select at least one effective date.");
  }

  return {
    ...payload,
    effectiveDates: normalizedDates,
    effectiveFrom: normalizedDates[0],
    effectiveTo: normalizedDates[normalizedDates.length - 1],
  };
}

function buildDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
}

function buildMonthDateKeys(year: number, month: number) {
  const dayCount = new Date(year, month, 0).getDate();
  return Array.from({ length: dayCount }, (_, index) =>
    buildDateKey(year, month, index + 1),
  );
}

function toNumber(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function formatMonthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

async function requireExistingLeaveType(code: string, database: DbLike = db) {
  await ensureDefaultLeaveTypes();

  const leaveType = await getLeaveTypeByCode(code.trim(), database);
  if (!leaveType) {
    throw new Error("Selected leave type was not found.");
  }

  return leaveType;
}

async function assertManagerSubmittedLeave(args: {
  managerAccountId: string;
  leaveRecordId: number;
  database?: DbLike;
}) {
  const database = args.database ?? db;
  const submittedEvent = await database.query.employeeLeaveApprovalEvents.findFirst({
    where: and(
      eq(employeeLeaveApprovalEvents.leaveRecordId, args.leaveRecordId),
      eq(employeeLeaveApprovalEvents.action, "Submitted"),
      eq(employeeLeaveApprovalEvents.actorUserId, args.managerAccountId),
    ),
  });

  if (!submittedEvent) {
    throw new Error("Only requests submitted by this manager can be changed.");
  }
}

export async function getManagerEmployees() {
  const auth = await requireManager({ redirectTo: "/" });
  const departmentIds = await getManagerDepartmentIds(auth.accountId);

  if (departmentIds.length === 0) {
    return [];
  }

  return db
    .select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      employeeType: employees.employeeType,
      firstName: employees.firstName,
      middleName: employees.middleName,
      lastName: employees.lastName,
      departmentId: employeesGeneralInfo.departmentId,
      departmentName: department.name,
      departmentCode: department.code,
    })
    .from(employees)
    .innerJoin(
      employeesGeneralInfo,
      eq(employees.id, employeesGeneralInfo.employeeId),
    )
    .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
    .where(
      and(
        isNull(employees.deletedAt),
        isNull(employeesGeneralInfo.deletedAt),
        inArray(employeesGeneralInfo.departmentId, departmentIds),
      ),
    )
    .orderBy(
      asc(department.name),
      asc(employees.lastName),
      asc(employees.firstName),
    );
}

export async function getManagerDashboardData() {
  const [employeesForManager, scheduleRequests] = await Promise.all([
    getManagerEmployees(),
    getManagerScheduleRequests(),
  ]);

  const pendingScheduleRequests = scheduleRequests.filter(
    (request) => request.status === "Pending",
  ).length;

  return {
    employeeCount: employeesForManager.length,
    departmentCount: new Set(
      employeesForManager
        .map((employee) => employee.departmentId)
        .filter((departmentId): departmentId is number => departmentId != null),
    ).size,
    pendingScheduleRequests,
    employees: employeesForManager.slice(0, 8),
  };
}

export async function getManagerCalendarMonth(input: unknown) {
  const { year, month } = managerCalendarMonthSchema.parse(input);
  const auth = await requireManager({ redirectTo: "/" });
  const departmentIds = await getManagerDepartmentIds(auth.accountId);
  const dateKeys = buildMonthDateKeys(year, month);
  const startDate = dateKeys[0];
  const endDate = dateKeys[dateKeys.length - 1];

  if (departmentIds.length === 0) {
    return {
      year,
      month,
      monthLabel: formatMonthLabel(year, month),
      startDate,
      endDate,
      employeeCount: 0,
      days: dateKeys.map((date, index) => ({
        date,
        dayOfMonth: index + 1,
        employeeCount: 0,
        workingCount: 0,
        restDayCount: 0,
        overrideCount: 0,
        approvedLeaveCount: 0,
        approvedLeaveEmployeeCount: 0,
        employees: [],
      })),
    };
  }

  const employeeRows = await db
    .select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      middleName: employees.middleName,
      lastName: employees.lastName,
      departmentName: department.name,
      departmentCode: department.code,
      timekeeping: {
        id: employeesTimekeeping.id,
        employeeId: employeesTimekeeping.employeeId,
        timekeepingId: employeesTimekeeping.timekeepingId,
        shiftSchedule: employeesTimekeeping.shiftSchedule,
        checkInTime: employeesTimekeeping.checkInTime,
        checkOutTime: employeesTimekeeping.checkOutTime,
        restDay: employeesTimekeeping.restDay,
        hoursWorked: employeesTimekeeping.hoursWorked,
        minutesWorked: employeesTimekeeping.minutesWorked,
        createdAt: employeesTimekeeping.createdAt,
        updatedAt: employeesTimekeeping.updatedAt,
        deletedAt: employeesTimekeeping.deletedAt,
      },
    })
    .from(employees)
    .innerJoin(
      employeesGeneralInfo,
      eq(employees.id, employeesGeneralInfo.employeeId),
    )
    .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
    .leftJoin(
      employeesTimekeeping,
      eq(employees.id, employeesTimekeeping.employeeId),
    )
    .where(
      and(
        isNull(employees.deletedAt),
        isNull(employeesGeneralInfo.deletedAt),
        inArray(employeesGeneralInfo.departmentId, departmentIds),
      ),
    )
    .orderBy(
      asc(department.name),
      asc(employees.lastName),
      asc(employees.firstName),
    );

  const employeeIds = employeeRows.map((employee) => employee.id);

  if (employeeIds.length === 0) {
    return {
      year,
      month,
      monthLabel: formatMonthLabel(year, month),
      startDate,
      endDate,
      employeeCount: 0,
      days: dateKeys.map((date, index) => ({
        date,
        dayOfMonth: index + 1,
        employeeCount: 0,
        workingCount: 0,
        restDayCount: 0,
        overrideCount: 0,
        approvedLeaveCount: 0,
        approvedLeaveEmployeeCount: 0,
        employees: [],
      })),
    };
  }

  const [shiftAssignments, weeklyPatterns, approvedLeaveDays] = await Promise.all([
    db
      .select()
      .from(employeeShiftAssignments)
      .where(
        and(
          inArray(employeeShiftAssignments.employeeId, employeeIds),
          lte(employeeShiftAssignments.effectiveFrom, endDate),
          or(
            isNull(employeeShiftAssignments.effectiveTo),
            gte(employeeShiftAssignments.effectiveTo, startDate),
          ),
        ),
      )
      .orderBy(
        asc(employeeShiftAssignments.employeeId),
        desc(employeeShiftAssignments.effectiveFrom),
      ),
    db.query.employeeWeeklyShiftPatterns.findMany({
      where: and(
        inArray(employeeWeeklyShiftPatterns.employeeId, employeeIds),
        lte(employeeWeeklyShiftPatterns.effectiveFrom, endDate),
        or(
          isNull(employeeWeeklyShiftPatterns.effectiveTo),
          gte(employeeWeeklyShiftPatterns.effectiveTo, startDate),
        ),
      ),
      with: {
        days: true,
      },
    }),
    db
      .select({
        leaveRecordId: employeesLeaveRecords.id,
        employeeId: employeesLeaveRecords.employeeId,
        leaveType: employeesLeaveRecords.leaveType,
        leaveTypeName: leaveTypes.name,
        reason: employeesLeaveRecords.reason,
        leaveDate: employeeLeaveRecordDays.leaveDate,
        dayPart: employeeLeaveRecordDays.dayPart,
        quantity: employeeLeaveRecordDays.quantity,
      })
      .from(employeeLeaveRecordDays)
      .innerJoin(
        employeesLeaveRecords,
        eq(employeeLeaveRecordDays.leaveRecordId, employeesLeaveRecords.id),
      )
      .leftJoin(leaveTypes, eq(employeesLeaveRecords.leaveTypeId, leaveTypes.id))
      .where(
        and(
          inArray(employeesLeaveRecords.employeeId, employeeIds),
          eq(employeesLeaveRecords.leaveStatus, "Approved"),
          isNull(employeesLeaveRecords.deletedAt),
          gte(employeeLeaveRecordDays.leaveDate, startDate),
          lte(employeeLeaveRecordDays.leaveDate, endDate),
        ),
      )
      .orderBy(
        asc(employeeLeaveRecordDays.leaveDate),
        asc(employeesLeaveRecords.employeeId),
      ),
  ]);

  const assignmentsByEmployeeId = new Map<
    string,
    typeof shiftAssignments
  >();
  for (const assignment of shiftAssignments) {
    const current = assignmentsByEmployeeId.get(assignment.employeeId) ?? [];
    current.push(assignment);
    assignmentsByEmployeeId.set(assignment.employeeId, current);
  }

  const weeklyPatternsByEmployeeId = new Map<
    string,
    typeof weeklyPatterns
  >();
  for (const pattern of weeklyPatterns) {
    const current = weeklyPatternsByEmployeeId.get(pattern.employeeId) ?? [];
    current.push(pattern);
    weeklyPatternsByEmployeeId.set(pattern.employeeId, current);
  }

  const approvedLeavesByEmployeeDate = new Map<
    string,
    typeof approvedLeaveDays
  >();
  for (const leaveDay of approvedLeaveDays) {
    const key = `${leaveDay.employeeId}:${leaveDay.leaveDate}`;
    const current = approvedLeavesByEmployeeDate.get(key) ?? [];
    current.push(leaveDay);
    approvedLeavesByEmployeeDate.set(key, current);
  }

  const days = dateKeys.map((date, index) => {
    const employeesForDay = employeeRows.map((employee) => {
      const approvedLeaves = (
        approvedLeavesByEmployeeDate.get(`${employee.id}:${date}`) ?? []
      ).map((leaveDay) => ({
        leaveRecordId: leaveDay.leaveRecordId,
        leaveType: leaveDay.leaveType,
        leaveTypeName: leaveDay.leaveTypeName,
        dayPart: leaveDay.dayPart,
        quantity: toNumber(leaveDay.quantity),
        reason: leaveDay.reason,
      }));
      const resolvedSchedule = resolveEmployeeScheduleForDate({
        attendanceDate: date,
        assignments: assignmentsByEmployeeId.get(employee.id) ?? [],
        weeklyPatterns: weeklyPatternsByEmployeeId.get(employee.id) ?? [],
        legacyTimekeeping: employee.timekeeping,
      });
      const isRestDay = isResolvedScheduleRestDay(resolvedSchedule);
      const override = resolvedSchedule.overrideAssignment;
      const weeklyDay = resolvedSchedule.weeklyPatternDay;
      const shiftName =
        override?.shiftName ?? weeklyDay?.shiftName ?? null;
      const shiftCode =
        override?.shiftCode ?? weeklyDay?.shiftCode ?? null;
      const checkInTime = resolvedSchedule.shiftWindow.checkInTime;
      const checkOutTime = resolvedSchedule.shiftWindow.checkOutTime;

      return {
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        firstName: employee.firstName,
        middleName: employee.middleName,
        lastName: employee.lastName,
        departmentName: employee.departmentName,
        departmentCode: employee.departmentCode,
        source: resolvedSchedule.source,
        shiftName,
        shiftCode,
        checkInTime,
        checkOutTime,
        hoursPerDay: toNumber(resolvedSchedule.hoursPerDay),
        isRestDay,
        overrideEffectiveFrom: override?.effectiveFrom ?? null,
        overrideEffectiveTo: override?.effectiveTo ?? null,
        hasApprovedLeave: approvedLeaves.length > 0,
        approvedLeaves,
      };
    });

    const employeesWithApprovedLeave = employeesForDay.filter(
      (employee) => employee.hasApprovedLeave,
    );

    return {
      date,
      dayOfMonth: index + 1,
      employeeCount: employeesForDay.length,
      workingCount: employeesForDay.filter((employee) => !employee.isRestDay).length,
      restDayCount: employeesForDay.filter((employee) => employee.isRestDay).length,
      overrideCount: employeesForDay.filter(
        (employee) => employee.source === "OVERRIDE",
      ).length,
      approvedLeaveCount: employeesWithApprovedLeave.reduce(
        (total, employee) => total + employee.approvedLeaves.length,
        0,
      ),
      approvedLeaveEmployeeCount: employeesWithApprovedLeave.length,
      employees: employeesForDay,
    };
  });

  return {
    year,
    month,
    monthLabel: formatMonthLabel(year, month),
    startDate,
    endDate,
    employeeCount: employeeRows.length,
    days,
  };
}

export async function getManagerLeaveRecordsByYear(year: number) {
  const auth = await requireManager({ redirectTo: "/" });
  const departmentIds = await getManagerDepartmentIds(auth.accountId);
  if (departmentIds.length === 0) return [];

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const records = await db
    .select({
      id: employeesLeaveRecords.id,
      employeeId: employeesLeaveRecords.employeeId,
      dateFiled: employeesLeaveRecords.dateFiled,
      leaveStartDate: employeesLeaveRecords.leaveStartDate,
      leaveEndDate: employeesLeaveRecords.leaveEndDate,
      leaveType: employeesLeaveRecords.leaveType,
      leaveTypeName: leaveTypes.name,
      noOfDays: employeesLeaveRecords.noOfDays,
      dayPart: employeeLeaveRecordDays.dayPart,
      reason: employeesLeaveRecords.reason,
      leaveStatus: employeesLeaveRecords.leaveStatus,
      employeeNo: employees.employeeNo,
      employeeType: employees.employeeType,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(employeesLeaveRecords)
    .innerJoin(employees, eq(employeesLeaveRecords.employeeId, employees.id))
    .innerJoin(
      employeesGeneralInfo,
      eq(employees.id, employeesGeneralInfo.employeeId),
    )
    .leftJoin(leaveTypes, eq(employeesLeaveRecords.leaveTypeId, leaveTypes.id))
    .leftJoin(
      employeeLeaveRecordDays,
      eq(employeeLeaveRecordDays.leaveRecordId, employeesLeaveRecords.id),
    )
    .where(
      and(
        isNull(employees.deletedAt),
        isNull(employeesGeneralInfo.deletedAt),
        inArray(employeesGeneralInfo.departmentId, departmentIds),
        gte(employeesLeaveRecords.dateFiled, startDate),
        lte(employeesLeaveRecords.dateFiled, endDate),
      ),
    )
    .orderBy(desc(employeesLeaveRecords.dateFiled));

  const uniqueRecords = new Map<number, (typeof records)[number]>();
  for (const record of records) {
    if (!uniqueRecords.has(record.id)) {
      uniqueRecords.set(record.id, record);
    }
  }

  return [...uniqueRecords.values()].map((record) => ({
    ...record,
    leaveStartDate: record.leaveStartDate ?? record.dateFiled,
    leaveEndDate: record.leaveEndDate ?? null,
    noOfDays: Number(record.noOfDays),
    dayPart: record.dayPart ?? "FullDay",
    reason: record.reason ?? "",
  }));
}

export async function getManagerLeaveBalanceSummary(
  employeeId: string,
  year: number,
) {
  try {
    const auth = await requireManager();
    await assertManagerCanAccessEmployee({
      accountId: auth.accountId,
      employeeId,
    });

    const summary = await getEmployeeLeaveBalanceSummary(employeeId, year);
    return { data: summary, error: null };
  } catch (error) {
    console.error("Error fetching manager leave balance summary:", error);
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to fetch leave balance summary",
    };
  }
}

export async function createManagerLeaveRecord(input: unknown) {
  const auth = await requireManager();
  const payload = managerLeaveMutationSchema.parse(input);
  await assertManagerCanAccessEmployee({
    accountId: auth.accountId,
    employeeId: payload.employeeId,
  });

  const record = await db.transaction(async (tx) => {
    const leaveType = await requireExistingLeaveType(payload.leaveType, tx);
    const leaveEndDate = normalizeLeaveEndDate(payload.leaveEndDate);
    await assertNoApprovedLeaveDateConflict({
      employeeId: payload.employeeId,
      startDate: payload.leaveStartDate,
      endDate: leaveEndDate,
      database: tx,
    });

    const [createdRecord] = await tx
      .insert(employeesLeaveRecords)
      .values({
        employeeId: payload.employeeId,
        leaveTypeId: leaveType.id,
        dateFiled: payload.dateFiled,
        leaveStartDate: payload.leaveStartDate,
        leaveEndDate,
        leaveType: leaveType.code,
        noOfDays: "0.00",
        reason: payload.reason,
        leaveStatus: "Pending",
      })
      .returning();

    await replaceLeaveRecordDayDetails({
      leaveRecordId: createdRecord.id,
      employeeId: createdRecord.employeeId,
      startDate: createdRecord.leaveStartDate ?? createdRecord.dateFiled,
      endDate: createdRecord.leaveEndDate,
      leaveTypeId: leaveType.id,
      dayPart: payload.dayPart ?? "FullDay",
      database: tx,
    });

    await tx.insert(employeeLeaveApprovalEvents).values({
      leaveRecordId: createdRecord.id,
      actorUserId: auth.accountId,
      action: "Submitted",
      oldStatus: null,
      newStatus: "Pending",
    });

    return createdRecord;
  });

  revalidatePath("/managerLeaves");
  revalidatePath("/home/leaves");
  return { data: record, error: null };
}

export async function updateManagerLeaveRecord(input: unknown) {
  const auth = await requireManager();
  const payload = managerLeaveMutationSchema.required({ id: true }).parse(input);

  await assertManagerCanAccessEmployee({
    accountId: auth.accountId,
    employeeId: payload.employeeId,
  });

  const record = await db.transaction(async (tx) => {
    const existing = await tx.query.employeesLeaveRecords.findFirst({
      where: eq(employeesLeaveRecords.id, payload.id),
    });

    if (!existing || existing.leaveStatus !== "Pending") {
      throw new Error("Only pending leave requests can be updated.");
    }

    await assertManagerSubmittedLeave({
      managerAccountId: auth.accountId,
      leaveRecordId: existing.id,
      database: tx,
    });

    const leaveType = await requireExistingLeaveType(payload.leaveType, tx);
    const leaveEndDate = normalizeLeaveEndDate(payload.leaveEndDate);
    await assertNoApprovedLeaveDateConflict({
      employeeId: payload.employeeId,
      startDate: payload.leaveStartDate,
      endDate: leaveEndDate,
      database: tx,
    });

    const [updatedRecord] = await tx
      .update(employeesLeaveRecords)
      .set({
        employeeId: payload.employeeId,
        leaveTypeId: leaveType.id,
        dateFiled: payload.dateFiled,
        leaveStartDate: payload.leaveStartDate,
        leaveEndDate,
        leaveType: leaveType.code,
        reason: payload.reason,
        updatedAt: new Date(),
      })
      .where(eq(employeesLeaveRecords.id, payload.id))
      .returning();

    await replaceLeaveRecordDayDetails({
      leaveRecordId: updatedRecord.id,
      employeeId: updatedRecord.employeeId,
      startDate: updatedRecord.leaveStartDate ?? updatedRecord.dateFiled,
      endDate: updatedRecord.leaveEndDate,
      leaveTypeId: leaveType.id,
      dayPart: payload.dayPart ?? "FullDay",
      database: tx,
    });

    await tx.insert(employeeLeaveApprovalEvents).values({
      leaveRecordId: updatedRecord.id,
      actorUserId: auth.accountId,
      action: "Updated",
      oldStatus: "Pending",
      newStatus: "Pending",
    });

    return updatedRecord;
  });

  revalidatePath("/managerLeaves");
  revalidatePath("/home/leaves");
  return { data: record, error: null };
}

export async function cancelManagerLeaveRecord(id: number) {
  const auth = await requireManager();

  await db.transaction(async (tx) => {
    const existing = await tx.query.employeesLeaveRecords.findFirst({
      where: eq(employeesLeaveRecords.id, id),
    });

    if (!existing || existing.leaveStatus !== "Pending") {
      throw new Error("Only pending leave requests can be cancelled.");
    }

    await assertManagerCanAccessEmployee({
      accountId: auth.accountId,
      employeeId: existing.employeeId,
      database: tx,
    });
    await assertManagerSubmittedLeave({
      managerAccountId: auth.accountId,
      leaveRecordId: id,
      database: tx,
    });

    await tx
      .update(employeesLeaveRecords)
      .set({ leaveStatus: "Cancelled", updatedAt: new Date() })
      .where(eq(employeesLeaveRecords.id, id));

    await tx.insert(employeeLeaveApprovalEvents).values({
      leaveRecordId: id,
      actorUserId: auth.accountId,
      action: "Cancelled",
      oldStatus: "Pending",
      newStatus: "Cancelled",
    });
  });

  revalidatePath("/managerLeaves");
  revalidatePath("/home/leaves");
  return { error: null };
}

export async function listManagerWeeklyShiftPatterns(employeeId: string) {
  const auth = await requireManager({ redirectTo: "/" });
  await assertManagerCanAccessEmployee({ accountId: auth.accountId, employeeId });

  const patterns = await db.query.employeeWeeklyShiftPatterns.findMany({
    where: eq(employeeWeeklyShiftPatterns.employeeId, employeeId),
    with: {
      days: true,
    },
  });

  return patterns.sort((left, right) =>
    right.effectiveFrom.localeCompare(left.effectiveFrom) || right.id - left.id
  );
}

export async function listManagerShiftAssignments(employeeId: string) {
  const auth = await requireManager({ redirectTo: "/" });
  await assertManagerCanAccessEmployee({ accountId: auth.accountId, employeeId });

  return db
    .select()
    .from(employeeShiftAssignments)
    .where(eq(employeeShiftAssignments.employeeId, employeeId))
    .orderBy(desc(employeeShiftAssignments.effectiveFrom));
}

export async function submitManagerScheduleChangeRequest(input: unknown) {
  const auth = await requireManager();
  const payload = managerScheduleRequestSchema.parse(input);
  const schedulePayload =
    payload.action === "Create"
      ? normalizeEffectiveDatesForRequest(payload.payload)
      : payload.payload;
  await assertManagerCanAccessEmployee({
    accountId: auth.accountId,
    employeeId: schedulePayload.employeeId,
  });

  if (payload.action === "Delete" && !payload.targetAssignmentId) {
    throw new Error("Select an existing shift override before requesting deletion.");
  }

  if (payload.targetAssignmentId) {
    const existing = await db.query.employeeShiftAssignments.findFirst({
      where: eq(employeeShiftAssignments.id, payload.targetAssignmentId),
    });

    if (!existing || existing.employeeId !== schedulePayload.employeeId) {
      throw new Error("Selected shift override was not found for this employee.");
    }
  }

  const [request] = await db
    .insert(managerScheduleChangeRequests)
    .values({
      requestedByAccountId: auth.accountId,
      employeeId: schedulePayload.employeeId,
      targetAssignmentId: payload.targetAssignmentId ?? schedulePayload.id ?? null,
      action: payload.action,
      status: "Pending",
      payload: schedulePayload,
      reason: payload.reason?.trim() || null,
    })
    .returning();

  revalidatePath("/managerSchedules");
  revalidatePath("/home/schedule-requests");
  revalidatePath("/home/applications");
  return { data: request, error: null };
}

export async function updateManagerScheduleChangeRequest(input: unknown) {
  const auth = await requireManager();
  const payload = managerScheduleRequestUpdateSchema.parse(input);
  const schedulePayload = normalizeEffectiveDatesForRequest(payload.payload);
  await assertManagerCanAccessEmployee({
    accountId: auth.accountId,
    employeeId: schedulePayload.employeeId,
  });

  const existing = await db.query.managerScheduleChangeRequests.findFirst({
    where: and(
      eq(managerScheduleChangeRequests.id, payload.requestId),
      eq(managerScheduleChangeRequests.requestedByAccountId, auth.accountId),
      eq(managerScheduleChangeRequests.status, "Pending"),
      eq(managerScheduleChangeRequests.action, "Create"),
    ),
  });

  if (!existing) {
    throw new Error("Pending schedule request was not found.");
  }

  if (existing.employeeId !== schedulePayload.employeeId) {
    throw new Error("Schedule request employee cannot be changed.");
  }

  const [request] = await db
    .update(managerScheduleChangeRequests)
    .set({
      payload: schedulePayload,
      reason: payload.reason?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(managerScheduleChangeRequests.id, existing.id))
    .returning();

  revalidatePath("/managerSchedules");
  revalidatePath("/home/schedule-requests");
  revalidatePath("/home/applications");
  return { data: request, error: null };
}

export async function cancelManagerScheduleChangeRequest(input: unknown) {
  const auth = await requireManager();
  const payload = managerScheduleRequestIdSchema.parse(input);

  const existing = await db.query.managerScheduleChangeRequests.findFirst({
    where: and(
      eq(managerScheduleChangeRequests.id, payload.requestId),
      eq(managerScheduleChangeRequests.requestedByAccountId, auth.accountId),
      eq(managerScheduleChangeRequests.status, "Pending"),
      eq(managerScheduleChangeRequests.action, "Create"),
    ),
  });

  if (!existing) {
    throw new Error("Pending schedule request was not found.");
  }

  await assertManagerCanAccessEmployee({
    accountId: auth.accountId,
    employeeId: existing.employeeId,
  });

  const [request] = await db
    .update(managerScheduleChangeRequests)
    .set({
      status: "Cancelled",
      updatedAt: new Date(),
    })
    .where(eq(managerScheduleChangeRequests.id, existing.id))
    .returning();

  revalidatePath("/managerSchedules");
  revalidatePath("/home/schedule-requests");
  revalidatePath("/home/applications");
  return { data: request, error: null };
}

export async function getManagerScheduleRequests() {
  const auth = await requireManager({ redirectTo: "/" });
  const departmentIds = await getManagerDepartmentIds(auth.accountId);
  if (departmentIds.length === 0) return [];

  return db
    .select({
      id: managerScheduleChangeRequests.id,
      action: managerScheduleChangeRequests.action,
      status: managerScheduleChangeRequests.status,
      payload: managerScheduleChangeRequests.payload,
      reason: managerScheduleChangeRequests.reason,
      decisionNote: managerScheduleChangeRequests.decisionNote,
      createdAt: managerScheduleChangeRequests.createdAt,
      decidedAt: managerScheduleChangeRequests.decidedAt,
      employeeId: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      departmentName: department.name,
      departmentCode: department.code,
    })
    .from(managerScheduleChangeRequests)
    .innerJoin(employees, eq(managerScheduleChangeRequests.employeeId, employees.id))
    .innerJoin(
      employeesGeneralInfo,
      eq(employees.id, employeesGeneralInfo.employeeId),
    )
    .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
    .where(
      and(
        eq(managerScheduleChangeRequests.requestedByAccountId, auth.accountId),
        inArray(employeesGeneralInfo.departmentId, departmentIds),
      ),
    )
    .orderBy(desc(managerScheduleChangeRequests.createdAt));
}
