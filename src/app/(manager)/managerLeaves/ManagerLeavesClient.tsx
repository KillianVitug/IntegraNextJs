"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  cancelManagerLeaveRecord,
  createManagerLeaveRecord,
  getManagerLeaveBalanceSummary,
  getManagerLeaveRecordsByYear,
  updateManagerLeaveRecord,
} from "@/app/actions/managerAction";
import { FormActions, FormGrid } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";

type EmployeeOption = {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
};

type LeaveTypeOption = {
  id: string;
  name: string;
};

type LeaveRecord = Awaited<ReturnType<typeof getManagerLeaveRecordsByYear>>[number];

type Props = {
  employees: EmployeeOption[];
  leaveTypeOptions: LeaveTypeOption[];
  initialYear: number;
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatEmployeeLabel(employee: EmployeeOption) {
  return `${employee.lastName}, ${employee.firstName} (${formatEmployeeNoDisplay(
    employee.employeeNo,
  )})`;
}

function estimateDays(startDate: string, endDate: string) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : start;
  const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return diff > 0 ? diff : 1;
}

export function ManagerLeavesClient({
  employees,
  leaveTypeOptions,
  initialYear,
}: Props) {
  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<LeaveRecord | null>(null);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [year, setYear] = useState(initialYear);
  const [isPending, startTransition] = useTransition();
  const defaultEmployeeId = employees[0]?.id ?? "";
  const defaultLeaveType = leaveTypeOptions[0]?.id ?? "";
  const [form, setForm] = useState({
    employeeId: defaultEmployeeId,
    dateFiled: todayKey(),
    leaveStartDate: todayKey(),
    leaveEndDate: "",
    leaveType: defaultLeaveType,
    reason: "",
  });

  const noOfDays = useMemo(
    () => estimateDays(form.leaveStartDate, form.leaveEndDate),
    [form.leaveStartDate, form.leaveEndDate],
  );

  useEffect(() => {
    let active = true;

    const loadBalance = async () => {
      if (!form.employeeId || !form.leaveType || !form.leaveStartDate) {
        setAvailableBalance(0);
        return;
      }

      const selectedYear = new Date(form.leaveStartDate).getFullYear();
      const result = await getManagerLeaveBalanceSummary(
        form.employeeId,
        selectedYear,
      );
      if (!active) return;

      const selected = result.data?.find((item) => item.code === form.leaveType);
      setAvailableBalance(selected?.balance ?? 0);
    };

    void loadBalance();

    return () => {
      active = false;
    };
  }, [form.employeeId, form.leaveType, form.leaveStartDate]);

  const refresh = useCallback(async () => {
    const rows = await getManagerLeaveRecordsByYear(year);
    setRecords(rows);
  }, [year]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function resetForm() {
    setSelectedRecord(null);
    setForm({
      employeeId: defaultEmployeeId,
      dateFiled: todayKey(),
      leaveStartDate: todayKey(),
      leaveEndDate: "",
      leaveType: defaultLeaveType,
      reason: "",
    });
  }

  function editRecord(record: LeaveRecord) {
    if (record.leaveStatus !== "Pending") return;
    setSelectedRecord(record);
    setForm({
      employeeId: record.employeeId,
      dateFiled: record.dateFiled,
      leaveStartDate: record.leaveStartDate ?? record.dateFiled,
      leaveEndDate: record.leaveEndDate ?? "",
      leaveType: record.leaveType,
      reason: record.reason ?? "",
    });
  }

  function updateField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const payload = {
          ...form,
          dayPart: "FullDay",
          noOfDays,
          id: selectedRecord?.id,
        };
        const result = selectedRecord
          ? await updateManagerLeaveRecord(payload)
          : await createManagerLeaveRecord(payload);

        if (result?.error) {
          toast.error(result.error);
          return;
        }

        toast.success(selectedRecord ? "Leave request updated." : "Leave request submitted.");
        resetForm();
        await refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to save leave request.");
      }
    });
  }

  function handleCancelRequest() {
    if (!selectedRecord) return;

    startTransition(async () => {
      try {
        const result = await cancelManagerLeaveRecord(selectedRecord.id);
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Leave request cancelled.");
        resetForm();
        await refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to cancel leave request.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <form className="space-y-3 rounded-md border p-3" onSubmit={handleSubmit}>
        <FormGrid columns={3}>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Employee</label>
            <select
              name="employeeId"
              value={form.employeeId}
              onChange={(event) => updateField("employeeId", event.target.value)}
              required
              className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {formatEmployeeLabel(employee)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Date Filed</label>
            <Input
              type="date"
              value={form.dateFiled}
              required
              readOnly
              className="cursor-not-allowed bg-muted text-muted-foreground"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Leave Type</label>
            <select
              value={form.leaveType}
              onChange={(event) => updateField("leaveType", event.target.value)}
              required
              className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
            >
              {leaveTypeOptions.map((leaveType) => (
                <option key={leaveType.id} value={leaveType.id}>
                  {leaveType.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Leave Start</label>
            <Input
              type="date"
              value={form.leaveStartDate}
              onChange={(event) => updateField("leaveStartDate", event.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Leave End</label>
            <Input
              type="date"
              value={form.leaveEndDate}
              onChange={(event) => updateField("leaveEndDate", event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Chargeable Days</label>
            <Input value={noOfDays} readOnly />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Available Balance</label>
            <Input value={availableBalance.toFixed(2)} readOnly />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium">Reason</label>
            <Textarea
              value={form.reason}
              onChange={(event) => updateField("reason", event.target.value)}
              required
            />
          </div>
        </FormGrid>
        <FormActions align="start">
          <Button type="submit" disabled={isPending || employees.length === 0}>
            {isPending ? "Saving..." : selectedRecord ? "Update Request" : "Submit Request"}
          </Button>
          {selectedRecord ? (
            <>
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel Edit
              </Button>
              <Button type="button" variant="destructive" onClick={handleCancelRequest}>
                Cancel Request
              </Button>
            </>
          ) : null}
        </FormActions>
      </form>

      <div className="rounded-md border">
        <div className="flex items-center justify-between border-b p-3">
          <h2 className="text-lg font-semibold">Department Leave Requests</h2>
          <Input
            type="number"
            className="w-28"
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <TableRow
                key={record.id}
                className={record.leaveStatus === "Pending" ? "cursor-pointer" : ""}
                onClick={() => editRecord(record)}
              >
                <TableCell>
                  {record.lastName}, {record.firstName}
                  <div className="text-xs text-muted-foreground">
                    {formatEmployeeNoDisplay(record.employeeNo)}
                  </div>
                </TableCell>
                <TableCell>{record.leaveTypeName ?? record.leaveType}</TableCell>
                <TableCell>
                  {record.leaveStartDate}
                  {record.leaveEndDate ? ` to ${record.leaveEndDate}` : ""}
                </TableCell>
                <TableCell>{record.noOfDays}</TableCell>
                <TableCell>{record.leaveStatus}</TableCell>
                <TableCell>{record.reason || "-"}</TableCell>
              </TableRow>
            ))}
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No leave requests found for this year.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
