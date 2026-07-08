"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  authAccounts,
  department,
  employeeShiftAssignments,
  employees,
  employeesGeneralInfo,
  managerScheduleChangeRequests,
} from "@/db/schema";
import {
  deleteEmployeeShiftAssignment,
  saveEmployeeShiftAssignment,
} from "@/app/actions/shiftAssignmentAction";
import { recordAdminAuditEvent, requireAdminActor } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/server";

export async function listAdminScheduleChangeRequests() {
  await requireAdmin({ redirectTo: "/" });

  return db
    .select({
      id: managerScheduleChangeRequests.id,
      action: managerScheduleChangeRequests.action,
      status: managerScheduleChangeRequests.status,
      payload: managerScheduleChangeRequests.payload,
      reason: managerScheduleChangeRequests.reason,
      decisionNote: managerScheduleChangeRequests.decisionNote,
      targetAssignmentId: managerScheduleChangeRequests.targetAssignmentId,
      createdAt: managerScheduleChangeRequests.createdAt,
      decidedAt: managerScheduleChangeRequests.decidedAt,
      requesterEmail: authAccounts.email,
      employeeId: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      departmentName: department.name,
      departmentCode: department.code,
    })
    .from(managerScheduleChangeRequests)
    .innerJoin(
      authAccounts,
      eq(managerScheduleChangeRequests.requestedByAccountId, authAccounts.id),
    )
    .innerJoin(employees, eq(managerScheduleChangeRequests.employeeId, employees.id))
    .leftJoin(
      employeesGeneralInfo,
      eq(employees.id, employeesGeneralInfo.employeeId),
    )
    .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
    .orderBy(desc(managerScheduleChangeRequests.createdAt));
}

function revalidateScheduleRequestSurfaces() {
  revalidatePath("/home/schedule-requests");
  revalidatePath("/home/applications");
  revalidatePath("/managerSchedules");
  revalidatePath("/managerCalendar");
  revalidatePath("/shiftAssignments");
}

function getBundledEffectiveDates(payload: {
  effectiveDates?: string[] | null;
}) {
  return [...new Set(payload.effectiveDates ?? [])].filter(Boolean).sort();
}

async function resolveAppliedCreateAssignmentId(request: {
  targetAssignmentId: number | null;
  employeeId: string;
  payload: {
    shiftTableId: number;
    effectiveFrom: string;
    effectiveTo?: string | null;
  };
}) {
  if (request.targetAssignmentId) {
    const existing = await db.query.employeeShiftAssignments.findFirst({
      where: eq(employeeShiftAssignments.id, request.targetAssignmentId),
    });

    if (!existing || existing.employeeId !== request.employeeId) {
      throw new Error("The approved override linked to this request was not found.");
    }

    return existing.id;
  }

  const effectiveTo = request.payload.effectiveTo ?? null;
  const matches = await db
    .select({ id: employeeShiftAssignments.id })
    .from(employeeShiftAssignments)
    .where(
      and(
        eq(employeeShiftAssignments.employeeId, request.employeeId),
        eq(employeeShiftAssignments.shiftTableId, request.payload.shiftTableId),
        eq(employeeShiftAssignments.effectiveFrom, request.payload.effectiveFrom),
        effectiveTo
          ? eq(employeeShiftAssignments.effectiveTo, effectiveTo)
          : isNull(employeeShiftAssignments.effectiveTo),
      ),
    )
    .limit(2);

  if (matches.length !== 1) {
    throw new Error(
      "Unable to find a single applied override for this approved request.",
    );
  }

  return matches[0].id;
}

async function resolveAppliedCreateAssignmentIds(request: {
  targetAssignmentId: number | null;
  employeeId: string;
  payload: {
    shiftTableId: number;
    effectiveFrom: string;
    effectiveTo?: string | null;
    effectiveDates?: string[] | null;
    appliedAssignmentIds?: number[] | null;
  };
}) {
  const appliedAssignmentIds = [
    ...new Set(request.payload.appliedAssignmentIds ?? []),
  ].filter((id) => Number.isInteger(id) && id > 0);

  if (appliedAssignmentIds.length > 0) {
    const assignments = await db
      .select({ id: employeeShiftAssignments.id })
      .from(employeeShiftAssignments)
      .where(
        and(
          inArray(employeeShiftAssignments.id, appliedAssignmentIds),
          eq(employeeShiftAssignments.employeeId, request.employeeId),
        ),
      );

    if (assignments.length !== appliedAssignmentIds.length) {
      throw new Error("One or more applied overrides for this request were not found.");
    }

    return appliedAssignmentIds;
  }

  if (getBundledEffectiveDates(request.payload).length > 1) {
    throw new Error(
      "This bundled approved request is missing applied override references.",
    );
  }

  return [await resolveAppliedCreateAssignmentId(request)];
}

export async function approveManagerScheduleChangeRequest(args: {
  requestId: string;
  decisionNote?: string | null;
}) {
  const actor = await requireAdminActor();
  const request = await db.query.managerScheduleChangeRequests.findFirst({
    where: and(
      eq(managerScheduleChangeRequests.id, args.requestId),
      eq(managerScheduleChangeRequests.status, "Pending"),
    ),
  });

  if (!request) {
    throw new Error("Pending schedule change request not found.");
  }

  let appliedAssignmentId: number | null = null;
  let appliedAssignmentIds: number[] = [];
  let nextPayload = request.payload;

  if (request.action === "Delete") {
    const assignmentId = request.targetAssignmentId ?? request.payload.id;
    if (!assignmentId) {
      throw new Error("Schedule deletion request is missing an assignment id.");
    }
    await deleteEmployeeShiftAssignment({ id: assignmentId });
  } else {
    const effectiveDates =
      request.action === "Create"
        ? getBundledEffectiveDates(request.payload)
        : [];

    if (request.action === "Create" && effectiveDates.length > 0) {
      try {
        for (const effectiveDate of effectiveDates) {
          const result = await saveEmployeeShiftAssignment({
            ...request.payload,
            id: undefined,
            employeeId: request.employeeId,
            effectiveFrom: effectiveDate,
            effectiveTo: effectiveDate,
            appliedAssignmentIds: undefined,
          });

          if (result.assignmentId) {
            appliedAssignmentIds.push(result.assignmentId);
          }
        }
      } catch (error) {
        for (const assignmentId of [...appliedAssignmentIds].reverse()) {
          await deleteEmployeeShiftAssignment({ id: assignmentId });
        }

        throw error;
      }

      appliedAssignmentId = appliedAssignmentIds[0] ?? null;
      nextPayload = {
        ...request.payload,
        appliedAssignmentIds,
      };
    } else {
      const result = await saveEmployeeShiftAssignment({
        ...request.payload,
        id:
          request.action === "Update"
            ? request.targetAssignmentId ?? request.payload.id
            : undefined,
        employeeId: request.employeeId,
      });
      appliedAssignmentId = result.assignmentId ?? null;
      appliedAssignmentIds = appliedAssignmentId ? [appliedAssignmentId] : [];
      nextPayload =
        request.action === "Create"
          ? {
              ...request.payload,
              appliedAssignmentIds,
            }
          : request.payload;
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(managerScheduleChangeRequests)
      .set({
        status: "Approved",
        targetAssignmentId:
          request.action === "Create"
            ? appliedAssignmentId
            : request.targetAssignmentId,
        payload: nextPayload,
        decisionNote: args.decisionNote?.trim() || null,
        decidedByAccountId: actor.userId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(managerScheduleChangeRequests.id, request.id));

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "manager_schedule_change_request",
      entityId: request.id,
      action: "manager_schedule_change_request.approved",
      details: {
        employeeId: request.employeeId,
        action: request.action,
        targetAssignmentId:
          request.action === "Create"
            ? appliedAssignmentId
            : request.targetAssignmentId,
        appliedAssignmentIds,
        effectiveDates: getBundledEffectiveDates(request.payload),
      },
      database: tx,
    });
  });

  revalidateScheduleRequestSurfaces();
}

export async function denyManagerScheduleChangeRequest(args: {
  requestId: string;
  decisionNote?: string | null;
}) {
  const actor = await requireAdminActor();
  const note = args.decisionNote?.trim();
  if (!note) {
    throw new Error("A denial note is required.");
  }

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(managerScheduleChangeRequests)
      .set({
        status: "Denied",
        decisionNote: note,
        decidedByAccountId: actor.userId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(managerScheduleChangeRequests.id, args.requestId),
          eq(managerScheduleChangeRequests.status, "Pending"),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error("Pending schedule change request not found.");
    }

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "manager_schedule_change_request",
      entityId: updated.id,
      action: "manager_schedule_change_request.denied",
      details: {
        employeeId: updated.employeeId,
        action: updated.action,
        decisionNote: note,
      },
      database: tx,
    });
  });

  revalidateScheduleRequestSurfaces();
}

export async function voidApprovedManagerScheduleChangeRequest(args: {
  requestId: string;
  reason: string;
}) {
  const actor = await requireAdminActor();
  const reason = args.reason.trim();

  if (!reason) {
    throw new Error("A void reason is required.");
  }

  const request = await db.query.managerScheduleChangeRequests.findFirst({
    where: and(
      eq(managerScheduleChangeRequests.id, args.requestId),
      eq(managerScheduleChangeRequests.status, "Approved"),
    ),
  });

  if (!request) {
    throw new Error("Approved schedule request not found.");
  }

  if (request.action !== "Create") {
    throw new Error("Only approved created schedule overrides can be voided.");
  }

  const assignmentIds = await resolveAppliedCreateAssignmentIds(request);
  for (const assignmentId of assignmentIds) {
    await deleteEmployeeShiftAssignment({ id: assignmentId });
  }

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(managerScheduleChangeRequests)
      .set({
        status: "Voided",
        decisionNote: reason,
        decidedByAccountId: actor.userId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(managerScheduleChangeRequests.id, request.id),
          eq(managerScheduleChangeRequests.status, "Approved"),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error("Approved schedule request could not be marked voided.");
    }

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "manager_schedule_change_request",
      entityId: updated.id,
      action: "manager_schedule_change_request.voided",
      details: {
        employeeId: updated.employeeId,
        action: updated.action,
        targetAssignmentId: assignmentIds[0] ?? null,
        appliedAssignmentIds: assignmentIds,
        voidReason: reason,
      },
      database: tx,
    });
  });

  revalidateScheduleRequestSurfaces();
}
