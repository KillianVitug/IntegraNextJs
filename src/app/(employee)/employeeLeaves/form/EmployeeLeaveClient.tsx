"use client";

import { useEffect, useState } from "react";
import EmployeeLeaveForm from "./EmployeeLeaveForm";
import EmployeeLeaveRecordsTable from "./EmployeeLeaveRecordsTable";
import type { EmployeeLeaveRecord } from "./types";
import { getEmployeeLeaveRecordsByYear } from "@/app/actions/leaveAction";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";

type EmployeeSummary = {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
};

type LeaveTypeOption = {
  id: string;
  name: string;
};

type Props = {
  employee: EmployeeSummary;
  leaveTypeOptions: LeaveTypeOption[];
  initialYear: number;
};

export default function EmployeeLeaveClient({
  employee,
  leaveTypeOptions,
  initialYear,
}: Props) {
  const [selectedRecord, setSelectedRecord] = useState<EmployeeLeaveRecord | null>(null);
  const [year, setYear] = useState(initialYear);
  const [records, setRecords] = useState<EmployeeLeaveRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchByYear = async () => {
      setLoading(true);
      setSelectedRecord(null);
      const res = await getEmployeeLeaveRecordsByYear(year);
      setRecords(res.data ?? []);
      setLoading(false);
    };

    fetchByYear();
  }, [year]);

  const refreshRecords = async () => {
    setLoading(true);
    const res = await getEmployeeLeaveRecordsByYear(year);
    setRecords(res.data ?? []);
    setLoading(false);
  };

  const employeeDisplayName = `${employee.lastName}, ${
    employee.firstName
  } (${formatEmployeeNoDisplay(employee.employeeNo)})`;

  return (
    <div className="space-y-6">
      <EmployeeLeaveForm
        initialData={selectedRecord}
        selectedYear={year}
        onCancelEdit={() => setSelectedRecord(null)}
        onSuccess={refreshRecords}
        employeeDisplayName={employeeDisplayName}
        leaveTypeOptions={leaveTypeOptions}
      />

      <EmployeeLeaveRecordsTable
        records={records}
        loading={loading}
        selectedYear={year}
        onYearChange={setYear}
        onRowClick={(record) => {
          if (record.leaveStatus === "Pending") {
            setSelectedRecord(record);
          }
        }}
      />
    </div>
  );
}
