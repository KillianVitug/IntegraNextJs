"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/server";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";
import { EmployeeAccessError, getEmployeeAccountAccess, mutateEmployeeAccountAccess } from "@/lib/auth/employee-access";
import type { EmployeeAccountAccessMutation, EmployeeAccountAccessResult } from "@/lib/auth/employee-access-types";

function failure(error: unknown): EmployeeAccountAccessResult {
  if (error instanceof Error && ["Unauthorized.", "Authentication required."].includes(error.message)) {
    return { status: "error", message: "Your session expired. Sign in again, then reload account access." };
  }
  const knownGuardMessages = ["Forbidden.", "Your account no longer has permission to perform this action.", "At least one active System Admin account is required."];
  return {
    status: "error",
    message: error instanceof EmployeeAccessError ? error.message
      : error instanceof z.ZodError ? error.issues[0]?.message ?? "Review the account details."
        : error instanceof Error && knownGuardMessages.includes(error.message) ? error.message
          : "Account access could not be confirmed. Reload account access before retrying.",
  };
}

export async function getEmployeeAccountAccessAction(employeeId: string): Promise<EmployeeAccountAccessResult> {
  try {
    const actor = await requirePermission(AUTH_PERMISSIONS.ACCESS_MANAGE);
    const data = await getEmployeeAccountAccess(actor, employeeId);
    return { status: "success", message: "Saved employee account access loaded.", data };
  } catch (error) { return failure(error); }
}

export async function mutateEmployeeAccountAccessAction(input: EmployeeAccountAccessMutation): Promise<EmployeeAccountAccessResult> {
  try {
    const actor = await requirePermission(AUTH_PERMISSIONS.ACCESS_MANAGE);
    const result = await mutateEmployeeAccountAccess(actor, input);
    revalidatePath("/access-management");
    revalidatePath("/employeeMaster");
    return { status: "success", ...result };
  } catch (error) { return failure(error); }
}
