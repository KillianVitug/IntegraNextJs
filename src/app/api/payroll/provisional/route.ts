import { getCurrentAuthContext, hasPermission } from "@/lib/auth/server";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";
import { loadProvisionalPayroll } from "@/lib/payroll/provisional";
import { z } from "zod";
import { PayrollValidationError } from "@/lib/payroll/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const querySchema = z.object({ periodId: z.string().uuid(), group: z.enum(["Daily", "Monthly"]), asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), departmentId: z.coerce.number().int().positive().optional(), employeeId: z.string().uuid().optional() });

export async function GET(request: Request) {
  const auth = await getCurrentAuthContext();
  if (!auth) return Response.json({ error: "Sign in again to view the estimate." }, { status: 401, headers });
  if (auth.role !== "ADMIN" || !hasPermission(auth, AUTH_PERMISSIONS.PAYROLL_COMPUTE)) return Response.json({ error: "You do not have access to payroll estimates." }, { status: 403, headers });
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "Choose a valid payroll period, group and cutoff date." }, { status: 400, headers });
  try { return Response.json(await loadProvisionalPayroll(query.data), { headers }); }
  catch (error) {
    if(error instanceof PayrollValidationError)return Response.json({error:error.message},{status:400,headers});
    console.error("Provisional payroll read failed", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "The estimate could not be calculated. Your selection is retained. Retry this read; no payroll was created." }, { status: 503, headers });
  }
}
