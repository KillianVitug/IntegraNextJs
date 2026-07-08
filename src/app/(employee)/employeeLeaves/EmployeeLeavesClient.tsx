"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getEmployeeLeaveUsageByYear } from "@/app/actions/leaveAction";
import type { LeaveUsageSummary } from "./types";

const emptyUsage: LeaveUsageSummary = {
  entitledSickLeave: 0,
  entitledVacationLeave: 0,
  usedSickLeave: 0,
  usedVacationLeave: 0,
};

type Props = {
  initialYear: number;
};

function formatDays(value: number) {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

export default function EmployeeLeavesClient({ initialYear }: Props) {
  const [year, setYear] = useState(initialYear);
  const [usage, setUsage] = useState<LeaveUsageSummary>(emptyUsage);
  const [loading, setLoading] = useState(false);

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from(
      { length: currentYear - 2000 + 1 },
      (_, i) => String(2000 + i)
    );
  }, []);

  useEffect(() => {
    let active = true;

    const fetchUsage = async () => {
      setLoading(true);
      const res = await getEmployeeLeaveUsageByYear(year);
      if (!active) return;
      setUsage(res.data ?? emptyUsage);
      setLoading(false);
    };

    fetchUsage();

    return () => {
      active = false;
    };
  }, [year]);

  const sickRemaining = Math.max(
    0,
    usage.entitledSickLeave - usage.usedSickLeave
  );
  const vacationRemaining = Math.max(
    0,
    usage.entitledVacationLeave - usage.usedVacationLeave
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-bold">Used Leaves and Services</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Select year" />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild>
            <Link href="/employeeLeaves/form">Create Leave Request</Link>
          </Button>
        </div>
      </div>

      <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${loading ? "opacity-75" : ""}`}>
        <Card>
          <CardHeader>
            <CardTitle>Sick Leave</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Entitled</p>
                <p className="text-lg font-semibold">
                  {loading ? "..." : formatDays(usage.entitledSickLeave)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Used</p>
                <p className="text-lg font-semibold">
                  {loading ? "..." : formatDays(usage.usedSickLeave)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Remaining</p>
                <p className="text-lg font-semibold">
                  {loading ? "..." : formatDays(sickRemaining)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vacation Leave</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Entitled</p>
                <p className="text-lg font-semibold">
                  {loading ? "..." : formatDays(usage.entitledVacationLeave)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Used</p>
                <p className="text-lg font-semibold">
                  {loading ? "..." : formatDays(usage.usedVacationLeave)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Remaining</p>
                <p className="text-lg font-semibold">
                  {loading ? "..." : formatDays(vacationRemaining)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
