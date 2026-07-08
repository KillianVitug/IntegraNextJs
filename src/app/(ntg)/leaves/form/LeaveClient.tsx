"use client";

import { useEffect, useState } from "react";
import { LeaveForm } from "./LeaveForm";
import { LeaveRecordsTable } from "./LeaveRecordsTable";
import { LeaveRecord } from "./types";
import { getLeaveRecordsByYear } from "@/app/actions/leaveAction";
import { PageHeader } from "@/components/layout/page-layout";

type Employee = {
  id: string;
  employeeNo: string;
  employeeType?: string | null;
  firstName: string;
  lastName: string;
};

type LeaveTypeOption = {
  id: string;
  name: string;
};

interface Props {
  employees: Employee[];
  leaveTypeOptions: LeaveTypeOption[];
  initialYear: number;
  initialSelectedLeaveId?: number | null;
}

export default function LeaveClient({
  employees,
  leaveTypeOptions,
  initialYear,
  initialSelectedLeaveId = null,
}: Props) {
  const [selectedRecord, setSelectedRecord] = useState<LeaveRecord | null>(null);
  const [routeSelectedLeaveId, setRouteSelectedLeaveId] = useState<number | null>(
    initialSelectedLeaveId
  );
  const [year, setYear] = useState(initialYear);
  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchByYear = async () => {
      setLoading(true);
      setSelectedRecord(null); // exit edit mode
      const res = await getLeaveRecordsByYear(year);
      setRecords(res.data ?? []);
      setLoading(false);
    };

    fetchByYear();
  }, [year]);

  useEffect(() => {
    if (routeSelectedLeaveId == null) return;

    const matchedRecord =
      records.find((record) => record.id === routeSelectedLeaveId) ?? null;

    setSelectedRecord(matchedRecord);
  }, [records, routeSelectedLeaveId]);
  
  const refreshRecords = async () => {
    setLoading(true);
    const res = await getLeaveRecordsByYear(year);
    setRecords(res.data ?? []);
    setLoading(false);
  };

  const handleCancelEdit = () => {
    setSelectedRecord(null);
    setRouteSelectedLeaveId(null);
  };

  const handleRowClick = (record: LeaveRecord) => {
    setSelectedRecord(record);
    setRouteSelectedLeaveId(null);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leave Request"
        description="Create, approve, and review employee leave records."
      />
      <LeaveForm
        employees={employees}
        leaveTypeOptions={leaveTypeOptions}
        initialData={selectedRecord}
        selectedYear={year}
        onCancelEdit={handleCancelEdit}
        onSuccess={refreshRecords}
      />

      <LeaveRecordsTable
        records={records}
        loading={loading}
        selectedYear={year}
        onYearChange={setYear}
        onRowClick={handleRowClick}
      />
    </div>
  );
}
