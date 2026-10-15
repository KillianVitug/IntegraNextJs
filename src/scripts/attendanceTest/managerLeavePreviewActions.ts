import type { LeaveFormState } from "@/app/(manager)/managerLeaves/form-state";
import { readLeaveFormValues } from "@/app/(manager)/managerLeaves/form-state";

// Fictional browser-only action boundary. Real server actions are verified by
// the PGlite acceptance suite, not by this presentation harness.
let attempts = 0;
export async function submitManagerLeaveForm(previous: LeaveFormState, form: FormData): Promise<LeaveFormState> {
  const values = readLeaveFormValues(form);
  const next = { revision: previous.revision + 1, values };
  if (form.get("intent") === "balance") return { ...next, message: "Fictional balance checked; no request saved." };
  attempts++;
  if (new URLSearchParams(location.search).get("case") === "failure" && attempts === 1) return { ...next, error: "The request could not be saved. Your entries are retained. Try again." };
  const receipt = document.getElementById("fixture-receipt");
  if (receipt) receipt.textContent = JSON.stringify({ employeeId: values.employeeId, leaveType: values.leaveType, startDate: values.leaveStartDate, reason: values.reason, status: "Pending", attempts });
  return { ...next, values: { ...values, id: "1001" }, message: "Leave request submitted. Pending Admin review." };
}
