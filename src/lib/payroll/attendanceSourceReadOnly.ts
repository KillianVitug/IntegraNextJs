import "server-only";
import { PayrollValidationError } from "./validation";

export const ATTENDANCE_LOCAL_ONLY_MESSAGE = "Phone attendance is read-only in Integra. Use Attendance review to approve a local payroll override.";
export function rejectAttendanceSourceMutation(): never {
  throw new PayrollValidationError(ATTENDANCE_LOCAL_ONLY_MESSAGE);
}

/** Historical receipts are reads using the same credential as attendance imports. */
export async function readAttendanceSourceReceipt(kind: "plan" | "correction", id: string, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!["plan", "correction"].includes(kind) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new PayrollValidationError("Select a valid historical attendance receipt.");
  }
  const origin = new URL(process.env.ATTENDANCE_SOURCE_ORIGIN ?? "https://invalid.invalid");
  const token = process.env.ATTENDANCE_SOURCE_TOKEN ?? "";
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash || token.length < 32) {
    throw new PayrollValidationError("The read-only attendance connection is not configured.");
  }
  const url = new URL("/v1/integra/corrections", origin);
  url.search = new URLSearchParams({ kind, id }).toString();
  const response = await fetcher(url, { method: "GET", headers: { Authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new PayrollValidationError("Historical source receipt is unavailable. No attendance source update was sent.");
  const body = await response.text();
  if (body.length > 2000000) throw new PayrollValidationError("Historical source receipt was too large.");
  const receipt = JSON.parse(body) as Record<string, unknown>;
  if (!receipt || !["Applied", "Not found"].includes(String(receipt.state))) throw new PayrollValidationError("Historical source receipt could not be verified.");
  if (receipt.id != null && receipt.id !== id || kind === "plan" && receipt.state === "Applied" && (receipt.plan as { id?: string } | null)?.id !== id) {
    throw new PayrollValidationError("Historical source receipt belongs to another request.");
  }
  return receipt;
}
