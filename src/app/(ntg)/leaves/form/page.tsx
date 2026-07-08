// src/app/(ntg)/leaves/form/page.tsx
"use server";

import { getActiveEmployees } from "@/app/actions/employeeAction";
import LeaveClient from "@/app/(ntg)/leaves/form/LeaveClient";
import { ensureDefaultLeaveTypes } from "@/lib/payroll/leave";
import { fetchLeaveTypes } from "@/lib/queries/fetchLookupData";

function isValidYear(value: string | undefined) {
  if (!value) return false;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100;
}

function parseLeaveId(value: string | undefined) {
  if (!value) return null;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const currentYear = new Date().getFullYear();
  const initialYear = isValidYear(params.year)
    ? Number(params.year)
    : currentYear;
  const initialSelectedLeaveId = parseLeaveId(params.leaveId);

  await ensureDefaultLeaveTypes();

  const [employeesRes, leaveTypes] = await Promise.all([
    getActiveEmployees(),
    fetchLeaveTypes(),
  ]);

  return (
    <LeaveClient
      employees={employeesRes.data ?? []}
      leaveTypeOptions={leaveTypes.map((leaveType) => ({
        id: leaveType.code,
        name: `${leaveType.code} | ${leaveType.name}`,
      }))}
      initialYear={initialYear}
      initialSelectedLeaveId={initialSelectedLeaveId}
    />
  );
}
