/** Only intentionally public business-validation messages cross the action boundary. */
export class PayrollValidationError extends Error {}

export async function payrollActionResult<T>(operation: () => Promise<T>) {
  try {
    return { ok: true as const, data: await operation() };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof PayrollValidationError
        ? error.message
        : "Payroll could not be updated. Refresh the page and try again; if it continues, contact the administrator.",
    };
  }
}

export function assertPayrollTransition(current: string, next: string) {
  if (current === "Stale" && next !== "Void") {
    throw new PayrollValidationError("This payroll is outdated. Sync attendance, refresh DTR summaries and recompute the draft before reviewing it again.");
  }
  if (next === "Reviewed" && current === "Draft" || next === "Approved" && current === "Reviewed" || next === "Posted" && current === "Approved" || next === "Void" && ["Draft", "Stale", "Reviewed", "Approved"].includes(current)) return;
  if (next === "Void" && current === "Posted") throw new PayrollValidationError("Posted payroll cannot be voided directly. Ask the payroll administrator to arrange a linked adjustment.");
  throw new PayrollValidationError(`Cannot move payroll from ${current} to ${next}. Refresh the page to check its current status.`);
}

export function assertFileAttendanceBatch(sourceFormat: string) {
  if (sourceFormat === "API") throw new PayrollValidationError("This batch is managed by Attendance connection. Correct the source and sync the period again; API batches cannot be reverted as files.");
}
