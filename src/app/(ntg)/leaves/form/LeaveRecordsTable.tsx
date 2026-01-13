"use client";

import React, { useEffect, useState } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { getLeaveRecordsByYear } from "@/app/actions/leaveAction";
import { useToast } from "@/hooks/use-toast";
import { LeaveRecord } from "./types";

interface LeaveRecordsTableProps {
    reloadFlag: number;
    onRowClick: (record: LeaveRecord) => void;
  }

function getStatusStyles(status: string) {
    switch (status) {
        case "Denied":
            return "bg-red-100 text-red-700 border-red-400";
        case "Pending":
            return "bg-yellow-100 text-yellow-700 border-yellow-400";
        case "Approved":
            return "bg-green-100 text-green-700 border-green-400";
        default:
            return "bg-gray-100 text-gray-700 border-gray-400";
    }
}

function getLeaveTypeDisplayName(leaveType: string) {
    switch (leaveType) {
        case "VL":
            return "Vacation Leave";
        case "SL":
            return "Sick Leave";
        default:
            return leaveType;
    }
}

export function LeaveRecordsTable({ reloadFlag, onRowClick } : LeaveRecordsTableProps) {
    const { toast } = useToast();
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(currentYear.toString());
    const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Generate years for the select dropdown (current year and 2 years before/after)
    const years = Array.from({ length: currentYear - 2000 + 1 }, (_, i) => (2000 + i).toString());

    useEffect(() => {
        fetchLeaveRecords();
    }, [selectedYear, reloadFlag]); // eslint-disable-line react-hooks/exhaustive-deps

    const fetchLeaveRecords = async () => {
        setIsLoading(true);
        try {
          const result = await getLeaveRecordsByYear(parseInt(selectedYear));
          if (result.error) {
            toast({
              title: "Error",
              description: result.error,
              variant: "destructive",
            });
            return;
          }
      
          const parsedData: LeaveRecord[] = (result.data || []).map((record) => ({
            ...record,
            noOfDays: parseFloat(record.noOfDays), // ? Convert string to number
            reason: record.reason ?? "",           // Optional: handle nullable fields
            employeeNo: record.employeeNo ?? "",
            firstName: record.firstName ?? "",
            lastName: record.lastName ?? "",
            status: record.leaveStatus ?? "Pending",
          }));
      
          setLeaveRecords(parsedData);
        } catch (error) {
          console.error("Error fetching leave records:", error);
          toast({
            title: "Error",
            description: "Failed to fetch leave records",
            variant: "destructive",
          });
        } finally {
          setIsLoading(false);
        }
      };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Leave Records</h2>
                <Select
                    value={selectedYear}
                    onValueChange={setSelectedYear}
                >
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select year" />
                    </SelectTrigger>
                    <SelectContent>
                        {years.map((year) => (
                            <SelectItem key={year} value={year}>
                                {year}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Date Filed</TableHead>
                        <TableHead>Leave Type</TableHead>
                        <TableHead>Number of Days</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    
                    {isLoading ? (
                        <TableRow>
                            <TableCell colSpan={5} className="text-center">
                                Loading...
                            </TableCell>
                        </TableRow>
                    ) : leaveRecords.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={5} className="text-center">
                                No leave records found for {selectedYear}
                            </TableCell>
                        </TableRow>
                    ) : (
                        leaveRecords.map((record) => (
                            <TableRow key={record.id}
                            onClick={() => onRowClick(record)}
                            className="cursor-pointer hover:bg-gray-100"
                            >
                                <TableCell>
                                    {`${record.lastName}, ${record.firstName} (${record.employeeNo})`}
                                </TableCell>
                                <TableCell>{new Date(record.dateFiled).toLocaleDateString()}</TableCell>
                                <TableCell>{getLeaveTypeDisplayName(record.leaveType)}</TableCell>
                                <TableCell>{record.noOfDays}</TableCell>
                                <TableCell>{record.reason}</TableCell>
                                <TableCell>
                                    <span
                                        className={`inline-block px-3 py-1 rounded-full border font-semibold text-xs ${getStatusStyles(record.leaveStatus)}`}
                                    >
                                        {record.leaveStatus}
                                    </span>
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
    );
} 