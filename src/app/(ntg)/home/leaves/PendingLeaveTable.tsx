"use client";

import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { HomePendingLeaveRow } from "@/lib/queries/home";
import {
  formatEmployeeNoDisplay,
  getEmployeeTypeDisplay,
} from "@/utils/employeeDisplay";

function getLeaveTypeLabel(type: HomePendingLeaveRow["leaveType"]) {
  if (type === "VL") return "Vacation Leave";
  if (type === "SL") return "Sick Leave";
  return type;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-PH");
}

function formatLeaveDuration(start: string, end?: string | null) {
  if (!end || start === end) {
    return formatDate(start);
  }

  return `${formatDate(start)} - ${formatDate(end)}`;
}

function getStatusClasses(status: HomePendingLeaveRow["leaveStatus"]) {
  if (status === "Pending") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  }

  if (status === "Approved") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  }

  return "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
}

export function PendingLeaveTable({ rows }: { rows: HomePendingLeaveRow[] }) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Employee No.</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Leave Type</TableHead>
            <TableHead>Days</TableHead>
            <TableHead>Leave Date Range</TableHead>
            <TableHead>Date Filed</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className="cursor-pointer hover:bg-muted/60"
              onClick={() =>
                router.push(
                  `/leaves/form?year=${row.dateFiled.slice(0, 4)}&leaveId=${row.id}`
                )
              }
            >
              <TableCell className="font-medium">
                {[row.lastName, row.firstName].filter(Boolean).join(", ") ||
                  "Unknown employee"}
              </TableCell>
              <TableCell>{formatEmployeeNoDisplay(row.employeeNo) || "-"}</TableCell>
              <TableCell>
                {getEmployeeTypeDisplay({
                  employeeType: row.employeeType,
                  employeeNo: row.employeeNo,
                }) || "-"}
              </TableCell>
              <TableCell>{getLeaveTypeLabel(row.leaveType)}</TableCell>
              <TableCell>{row.noOfDays}</TableCell>
              <TableCell>
                {formatLeaveDuration(row.leaveStartDate, row.leaveEndDate)}
              </TableCell>
              <TableCell>{formatDate(row.dateFiled)}</TableCell>
              <TableCell>
                <div className="max-w-[260px] truncate" title={row.reason}>
                  {row.reason || "-"}
                </div>
              </TableCell>
              <TableCell>
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${getStatusClasses(
                    row.leaveStatus
                  )}`}
                >
                  {row.leaveStatus}
                </span>
              </TableCell>
            </TableRow>
          ))}

          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={9}
                className="py-10 text-center text-muted-foreground"
              >
                No pending leave requests are available.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
