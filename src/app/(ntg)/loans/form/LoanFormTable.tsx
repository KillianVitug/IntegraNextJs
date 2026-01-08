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
import { getEmployeeLoan } from "@/app/actions/loanAction";
import { selectEmployeeLoanSchema } from "@/zod-schemas/employeeLoan";
import { z } from "zod";

// ✅ infer TS type from zod schema
type EmployeeLoan = z.infer<typeof selectEmployeeLoanSchema>;

interface LoanFormTableProps {
    loanId?: string; // ✅ new prop
    reloadFlag: number;
  }

export function LoanFormTable({ loanId, reloadFlag } : LoanFormTableProps) {
    const [loans, setLoans] = useState<EmployeeLoan[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        // ✅ only fetch when employeeId exists
        if (loanId) {
          fetchLoans(loanId);
        }
      }, [loanId, reloadFlag]);

    const fetchLoans = async (loanId: string) => {
        setIsLoading(true);
        try {
          const result = await getEmployeeLoan(loanId);
          if (result.length === 0) {
            return;
          }
      
          const parsedData: EmployeeLoan[] = result.map((loan: any) => ({
            ...loan,
            period: loan.loanDate,
            dateCovered: loan.loanPaymentData,
            amount: loan.amountGranted,
          }));
      
          setLoans(parsedData);
        } catch (error) {
          console.error("Error fetching loans:", error);
        } finally {
          setIsLoading(false);
        }
      };

      if (!loanId) {
        return null;
      }
      
    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Loan Records</h2>
            </div>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead>Date Covered</TableHead>
                        <TableHead>Amount</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    
                    {isLoading ? (
                        <TableRow>
                            <TableCell colSpan={5} className="text-center">
                                Loading...
                            </TableCell>
                        </TableRow>
                    ) : (
                        loans.map((loan) => (
                            <TableRow key={loan.id}
                            className="cursor-pointer hover:bg-gray-100"
                            >
                                <TableCell>
                                    {`${loan.payrollDateDeduction}`}
                                </TableCell>
                                <TableCell>{new Date(loan.payrollDateDeduction).toLocaleDateString()}</TableCell>
                                <TableCell>{loan.amortization}</TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
    );
} 