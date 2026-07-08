"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getEmployeeServiceSummary } from "@/app/actions/leaveAction";
import type { EmployeeServiceSummary } from "./types";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";


export default function EmployeeServiceTable() {
  const [service, setService] = useState<EmployeeServiceSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const fetchService = async () => {
      setLoading(true);
      const res = await getEmployeeServiceSummary();
      if (!active) return;
      setService(res.data ?? null);
      setLoading(false);
    };

    fetchService();

    return () => {
      active = false;
    };
  }, []);

  const serviceMetrics = useMemo(() => {
    if (!service?.dateHired) {
      return { years: "0.00", months: "0.00" };
    }

    const hiredDate = new Date(service.dateHired);
    const asOfDate = new Date();
    const totalMonths =
      (asOfDate.getTime() - hiredDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);

    const years = (totalMonths / 12).toFixed(2);
    const months = totalMonths.toFixed(2);

    return { years, months };
  }, [service]);

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">Service Summary</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee No</TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>Date Hired</TableHead>
            <TableHead>Years of Service</TableHead>
            <TableHead>Months of Service</TableHead>
            <TableHead>Department</TableHead>

          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center">
                Loading...
              </TableCell>
            </TableRow>
          ) : !service ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center">
                No service data found
              </TableCell>
            </TableRow>
          ) : (
            <TableRow>
              <TableCell>{formatEmployeeNoDisplay(service.employeeNo)}</TableCell>
              <TableCell>{service.fullName}</TableCell>
              <TableCell>
                {service.dateHired
                  ? new Date(service.dateHired).toLocaleDateString()
                  : "-"}
              </TableCell>
              <TableCell>{serviceMetrics.years}</TableCell>
              <TableCell>{serviceMetrics.months}</TableCell>
              <TableCell>{service.department ?? "-"}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
