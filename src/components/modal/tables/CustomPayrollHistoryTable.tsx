"use client";

import { useEffect, useState } from "react";

type CustomPayrollHistoryRow = {
  id: number;
  effectiveDate: string;
  endDate: string | null;
  oldPayrollCode: string | null;
  newPayrollCode: string;
};

export default function CustomPayrollHistoryTable({
  employeeId,
}: {
  employeeId: string;
}) {
  const [rows, setRows] = useState<CustomPayrollHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await fetch(
        `/api/employees/${employeeId}/custom-payroll-history`
      );
      const json = await res.json();
      setRows(json.data ?? []);
      setLoading(false);
    }

    load();
  }, [employeeId]);

  if (loading) return <p className="text-sm">Loading...</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="border px-3 py-2">Effective Date</th>
            <th className="border px-3 py-2">Old Payroll</th>
            <th className="border px-3 py-2">New Payroll</th>
            <th className="border px-3 py-2">End Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="border px-3 py-2">
                {new Date(r.effectiveDate).toLocaleDateString()}
              </td>

              <td className="border px-3 py-2 text-muted-foreground">
                {r.oldPayrollCode ?? "—"}
              </td>

              <td className="border px-3 py-2 font-semibold">
                {r.newPayrollCode}
              </td>

              <td className="border px-3 py-2">
                {r.endDate
                  ? new Date(r.endDate).toLocaleDateString()
                  : (
                    <span className="text-green-600 font-medium">
                      Active
                    </span>
                  )}
              </td>
            </tr>
          ))}

          {!rows.length && (
            <tr>
              <td
                colSpan={4}
                className="px-3 py-6 text-center text-muted-foreground"
              >
                No custom payroll history found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
