"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";
import { cancelManagerLeaveForm, checkManagerLeaveBalanceForm, saveManagerLeaveForm } from "./actions";
import type { LeaveFormState } from "./form-state";

type Props = {
  employees: { id: string; employeeNo: string; firstName: string; lastName: string }[];
  leaveTypes: { id: number; code: string; name: string }[];
  initialState: LeaveFormState;
  permalink?: string;
};

export function ManagerLeaveForm({ employees, leaveTypes, initialState, permalink }: Props) {
  const actionPermalink = permalink ?? `/managerLeaves?year=${encodeURIComponent(initialState.values.year)}${initialState.values.id ? `&editLeaveId=${encodeURIComponent(initialState.values.id)}` : ""}`;
  const [saveState, saveAction, saving] = useActionState(saveManagerLeaveForm, initialState, actionPermalink);
  const [balanceState, balanceAction, checkingBalance] = useActionState(checkManagerLeaveBalanceForm, initialState, actionPermalink);
  const [cancelState, cancelAction, cancelling] = useActionState(cancelManagerLeaveForm, initialState, actionPermalink);
  const state = [saveState, balanceState, cancelState].reduce((latest, next) => next.revision > latest.revision ? next : latest, initialState);
  const pending = saving || checkingBalance || cancelling;
  const values = state.values;
  const selectClass = "flex min-h-11 w-full rounded-md border bg-background px-3 py-2 text-base md:text-sm";
  return (
    <form action={saveAction} aria-busy={pending} className="space-y-3 rounded-md border p-3">
      <h2 className="text-lg font-semibold">{values.id ? `Edit request #${values.id}` : "New leave request"}</h2>
      <p className="text-sm text-muted-foreground">Select the employee and leave type for this request. Filing keeps it pending for HR review. Only your pending requests can be changed.</p>
      {state.error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p> : null}
      {state.message ? <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{state.message}</p> : null}
      {employees.length === 0 ? <p role="status" className="text-sm">No employees are assigned to your departments. Ask the account administrator to check your access.</p> : null}
      {leaveTypes.length === 0 ? <p role="status" className="text-sm">No leave types are configured. Ask HR to complete setup before filing.</p> : null}
      <fieldset key={state.revision} disabled={pending || employees.length === 0 || leaveTypes.length === 0} className="space-y-3">
        <input type="hidden" name="id" value={values.id} />
        <input type="hidden" name="year" value={values.year} />
        <input type="hidden" name="dayPart" value={values.dayPart} />
        <input type="hidden" name="formRevision" value={state.revision} />
        <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-employee">Employee</label>
            <select id="leave-employee" name="employeeId" defaultValue={values.employeeId} required className={selectClass}>
              <option value="">Select an employee</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.lastName}, {employee.firstName} ({formatEmployeeNoDisplay(employee.employeeNo)})</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-type">Leave type</label>
            <select id="leave-type" name="leaveType" defaultValue={values.leaveType} required className={selectClass}>
              <option value="">Select a leave type</option>
              {leaveTypes.map((type) => <option key={type.id} value={type.code}>{type.code} | {type.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-date-filed">Date filed</label>
            <Input id="leave-date-filed" name="dateFiled" type="date" defaultValue={values.dateFiled} readOnly />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-start">Leave start</label>
            <Input id="leave-start" name="leaveStartDate" type="date" defaultValue={values.leaveStartDate} required />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-end">Leave end (optional for one day)</label>
            <Input id="leave-end" name="leaveEndDate" type="date" defaultValue={values.leaveEndDate} />
          </div>
          <p className="text-sm text-muted-foreground md:self-end">Duration: {values.dayPart === "FullDay" ? "Full day" : `${values.dayPart} half day`}. The saved request shows the calculated days.</p>
          <div className="md:col-span-2 xl:col-span-3">
            <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-reason">Reason</label>
            <Textarea id="leave-reason" name="reason" defaultValue={values.reason} required maxLength={4000} />
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="submit" formAction={saveAction} className="min-h-11">{saving ? "Please wait…" : values.id ? "Update request" : "Submit request"}</Button>
          <Button type="submit" formAction={balanceAction} formNoValidate variant="outline" className="min-h-11">{checkingBalance ? "Checking balance…" : "Check balance"}</Button>
          {values.id ? <Button type="submit" formAction={cancelAction} formNoValidate variant="destructive" className="min-h-11">{cancelling ? "Cancelling…" : "Cancel request"}</Button> : null}
          <Button asChild variant="outline" className="min-h-11"><a href={`/managerLeaves?year=${values.year}`}>Start a new request</a></Button>
        </div>
      </fieldset>
      {state.balance ? <p role="status" className="text-sm">
        Balance checked for {employees.find((employee) => employee.id === state.balance?.employeeId)?.lastName}, {employees.find((employee) => employee.id === state.balance?.employeeId)?.firstName} — {state.balance.leaveType}, {state.balance.year}: {state.balance.requiresBalance ? `${state.balance.days.toFixed(2)} day(s) available.` : "This type does not require a balance."} Check again after changing employee, type or year. Pending filing does not reserve or approve leave.
      </p> : null}
    </form>
  );
}
