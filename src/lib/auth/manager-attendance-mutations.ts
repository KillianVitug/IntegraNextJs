import "server-only";
import { NextResponse } from "next/server";
import { getCurrentAuthContext, requireManager, type AuthContext } from "./server";
import { MANAGER_ATTENDANCE_READ_ONLY_MESSAGE } from "./manager-attendance-policy";

/**
 * Retained legacy action names must not grant financial authority. Keep this
 * check before validation, scope reads, imports, audit writes and computation.
 * Payroll Admin uses the existing separately authorized payroll actions.
 */
export async function requireManagerAttendanceMutation(): Promise<AuthContext> {
  await requireManager();
  throw new Error(MANAGER_ATTENDANCE_READ_ONLY_MESSAGE);
}

/** Unmatched import rows may contain unrestricted source/administrator text. */
export async function requireManagerImportDiagnostics(): Promise<AuthContext> {
  await requireManager();
  throw new Error("Payroll Admin reviews unmatched import details. Use Attendance or provisional review for employee evidence within your assigned departments.");
}

/** Reject old HTML POST routes before reading potentially large upload bodies. */
export async function rejectManagerAttendanceMutationRequest() {
  const auth = await getCurrentAuthContext();
  return NextResponse.json(
    { error: auth ? MANAGER_ATTENDANCE_READ_ONLY_MESSAGE : "Sign in to continue." },
    {
      status: auth ? 403 : 401,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
