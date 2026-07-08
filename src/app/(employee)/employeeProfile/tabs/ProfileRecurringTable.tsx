"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EmployeeRecurringEntryFormType } from "@/zod-schemas/employeeRecurringEntries";
import { displayValue, formatDateValue, formatMoneyValue } from "../utils";

type Props = {
  entries: EmployeeRecurringEntryFormType[];
};

export default function ProfileRecurringTable({ entries }: Props) {
  return (
    <div className="mt-4 border rounded-md overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account Code</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Frequency</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Start Date</TableHead>
            <TableHead>End Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No recurring entries found.
              </TableCell>
            </TableRow>
          ) : (
            entries.map((entry) => (
              <TableRow key={String(entry.id)}>
                <TableCell>{displayValue(entry.accountCode)}</TableCell>
                <TableCell>{formatMoneyValue(entry.amount)}</TableCell>
                <TableCell>{displayValue(entry.frequency)}</TableCell>
                <TableCell>{displayValue(entry.status)}</TableCell>
                <TableCell>{formatDateValue(entry.startDate)}</TableCell>
                <TableCell>{formatDateValue(entry.endDate)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
