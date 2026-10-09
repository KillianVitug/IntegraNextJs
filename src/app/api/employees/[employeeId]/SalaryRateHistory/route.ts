import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentAuthContext, hasPermission } from "@/lib/auth/server";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";
import { getSalaryRateHistory } from "@/lib/queries/getSalaryRateHistory";

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ employeeId: string }> }
) {
  try {
    const auth = await getCurrentAuthContext();
    if (!auth) {
      return privateJson({ error: "Unauthorized." }, 401);
    }
    if (!hasPermission(auth, AUTH_PERMISSIONS.SALARY_MANAGE)) {
      return privateJson({ error: "Forbidden." }, 403);
    }

    const { employeeId } = await context.params;

    if (!z.string().uuid().safeParse(employeeId).success) {
      return privateJson({ error: "A valid employee ID is required." }, 400);
    }

    const data = await getSalaryRateHistory(employeeId);

    return privateJson({ data });
  } catch (error) {
    console.error("SalaryRateHistory API error:", error);

    return privateJson({ error: "Failed to fetch salary rate history" }, 500);
  }
}
