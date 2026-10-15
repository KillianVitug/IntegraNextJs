"use server";

import {
  cancelManagerLeaveRecord, createManagerLeaveRecord, getManagerLeaveBalanceSummary, updateManagerLeaveRecord,
} from "@/app/actions/managerAction";
import { z } from "zod";
import { leaveFormPayload, readLeaveFormValues, safeLeaveError, type LeaveFormState } from "./form-state";

type LeaveIntent = "save" | "balance" | "cancel";

async function runManagerLeaveForm(previous: LeaveFormState, formData: FormData, explicitIntent?: LeaveIntent): Promise<LeaveFormState> {
  const values = readLeaveFormValues(formData);
  const previousRevision = Number.isSafeInteger(previous.revision) && previous.revision >= 0 && previous.revision < Number.MAX_SAFE_INTEGER ? previous.revision : 0;
  let state: LeaveFormState = { values, revision: previousRevision + 1 };
  try {
    // All three action states post the latest displayed revision. It orders UI
    // replies only; employee authority and request status remain server checks.
    const revisions = formData.getAll("formRevision");
    if (revisions.length > 1) return { ...state, error: "The form changed. Reload before trying again. No changes were saved." };
    if (revisions.length && (typeof revisions[0] !== "string" || !/^(0|[1-9]\d*)$/.test(revisions[0]))) {
      return { ...state, error: "The form changed. Reload before trying again. No changes were saved." };
    }
    const postedRevision = revisions.length ? Number(revisions[0]) : previousRevision;
    if (!Number.isSafeInteger(postedRevision) || postedRevision < 0 || postedRevision >= Number.MAX_SAFE_INTEGER) {
      return { ...state, error: "The form changed. Reload before trying again. No changes were saved." };
    }
    state = { ...state, revision: Math.max(previousRevision, postedRevision) + 1 };
    const intents = formData.getAll("intent");
    const suppliedIntent = intents.length === 1 && typeof intents[0] === "string" && ["save", "balance", "cancel"].includes(intents[0]) ? intents[0] as LeaveIntent : null;
    // Explicit wrappers use their server action identity, including native POSTs.
    // Legacy/ambiguous calls must never fall through to a business mutation.
    if ((!explicitIntent && !suppliedIntent) || (intents.length > 0 && (!suppliedIntent || (explicitIntent && explicitIntent !== suppliedIntent)))) {
      return { ...state, error: "Choose an action and try again. No changes were saved." };
    }
    const intent = explicitIntent ?? suppliedIntent;
    if (intent === "balance") {
      z.string().uuid("Select an employee.").parse(values.employeeId);
      z.string().min(1, "Select a leave type.").parse(values.leaveType);
      const year = Number(values.leaveStartDate.slice(0, 4));
      z.number().int().min(1900).max(2100).parse(year);
      const result = await getManagerLeaveBalanceSummary(values.employeeId, year);
      if (result.error) throw new Error(result.error);
      const selected = result.data?.find((item) => item.code === values.leaveType);
      if (!selected) throw new Error("Selected leave type was not found.");
      return { ...state, balance: { employeeId: values.employeeId, leaveType: values.leaveType, year, days: selected.balance, requiresBalance: selected.requiresBalance } };
    }
    if (intent === "cancel") {
      await cancelManagerLeaveRecord(z.coerce.number().int().positive().parse(values.id));
      return { ...state, message: `Request #${values.id} cancelled.`, values: { ...values, id: "" } };
    }
    const payload = leaveFormPayload(values);
    const result = values.id
      ? await updateManagerLeaveRecord({ ...payload, id: values.id })
      : await createManagerLeaveRecord(payload);
    if (result.error || !result.data) throw new Error(result.error ?? "Save was not confirmed.");
    const saved = result.data;
    return {
      ...state,
      values: { ...values, id: String(saved.id), employeeId: saved.employeeId, leaveType: saved.leaveType,
        dateFiled: saved.dateFiled, leaveStartDate: saved.leaveStartDate ?? saved.dateFiled,
        leaveEndDate: saved.leaveEndDate ?? "", reason: saved.reason ?? "" },
      message: `Request #${saved.id} saved — ${saved.leaveStatus}. ${Number(saved.noOfDays)} day(s). This is a request for HR review, not an approval.`,
    };
  } catch (error) {
    return { ...state, error: safeLeaveError(error) };
  }
}

export async function submitManagerLeaveForm(previous: LeaveFormState, formData: FormData): Promise<LeaveFormState> {
  return runManagerLeaveForm(previous, formData);
}

export async function saveManagerLeaveForm(previous: LeaveFormState, formData: FormData): Promise<LeaveFormState> {
  return runManagerLeaveForm(previous, formData, "save");
}

export async function checkManagerLeaveBalanceForm(previous: LeaveFormState, formData: FormData): Promise<LeaveFormState> {
  return runManagerLeaveForm(previous, formData, "balance");
}

export async function cancelManagerLeaveForm(previous: LeaveFormState, formData: FormData): Promise<LeaveFormState> {
  return runManagerLeaveForm(previous, formData, "cancel");
}
