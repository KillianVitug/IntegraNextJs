"use server";

import {
  cancelManagerLeaveRecord, createManagerLeaveRecord, getManagerLeaveBalanceSummary, updateManagerLeaveRecord,
} from "@/app/actions/managerAction";
import { z } from "zod";
import { leaveFormPayload, readLeaveFormValues, safeLeaveError, type LeaveFormState } from "./form-state";

export async function submitManagerLeaveForm(previous: LeaveFormState, formData: FormData): Promise<LeaveFormState> {
  const values = readLeaveFormValues(formData);
  const state: LeaveFormState = { values, revision: previous.revision + 1 };
  try {
    const intent = String(formData.get("intent") ?? "save");
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
