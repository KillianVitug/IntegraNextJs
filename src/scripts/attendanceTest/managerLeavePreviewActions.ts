import type { LeaveFormState } from "@/app/(manager)/managerLeaves/form-state";
import { leaveFormPayload, readLeaveFormValues, safeLeaveError } from "@/app/(manager)/managerLeaves/form-state";

// Fictional browser-only action boundary. Real server actions are verified by
// the PGlite acceptance suite, not by this presentation harness.
let attempts = 0;
async function run(previous: LeaveFormState, form: FormData, operation: "save" | "balance" | "cancel"): Promise<LeaveFormState> {
  const values = readLeaveFormValues(form);
  const next = { revision: Math.max(previous.revision, Number(form.get("formRevision") ?? previous.revision)) + 1, values };
  const recorder = (globalThis as typeof globalThis & { recordIntent?: (value: unknown) => void }).recordIntent;
  recorder?.({ kind: "action", operation, intent: form.get("intent"), allIntents: form.getAll("intent"), revision: next.revision });
  if (operation === "balance") return { ...next, message: "Fictional balance checked; no request saved.", balance: { employeeId: values.employeeId, leaveType: values.leaveType, year: 2026, days: 5, requiresBalance: true } };
  if (operation === "cancel") return { ...next, values: { ...values, id: "" }, message: `Fictional request #${values.id} cancelled.` };
  try { leaveFormPayload(values); } catch (error) { return { ...next, error: safeLeaveError(error) }; }
  attempts++;
  if (new URLSearchParams(location.search).get("case") === "failure" && attempts === 1) return { ...next, error: "The request could not be saved. Your entries are retained. Try again." };
  const receipt = document.getElementById("fixture-receipt");
  if (receipt) receipt.textContent = JSON.stringify({ employeeId: values.employeeId, leaveType: values.leaveType, startDate: values.leaveStartDate, reason: values.reason, status: "Pending", attempts });
  return { ...next, values: { ...values, id: "1001" }, message: "Leave request submitted. Pending Admin review." };
}

export async function submitManagerLeaveForm(previous: LeaveFormState, form: FormData): Promise<LeaveFormState> {
  const intent = form.get("intent");
  if (intent !== "save" && intent !== "balance" && intent !== "cancel") return { revision: previous.revision + 1, values: readLeaveFormValues(form), error: "Choose an action. No changes were saved." };
  return run(previous, form, intent);
}
export async function saveManagerLeaveForm(previous: LeaveFormState, form: FormData) { return run(previous, form, "save"); }
export async function checkManagerLeaveBalanceForm(previous: LeaveFormState, form: FormData) { return run(previous, form, "balance"); }
export async function cancelManagerLeaveForm(previous: LeaveFormState, form: FormData) { return run(previous, form, "cancel"); }
