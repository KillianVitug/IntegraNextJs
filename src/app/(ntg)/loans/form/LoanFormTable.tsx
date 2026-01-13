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
import { EmployeeLoanList } from "@/zod-schemas/employeeLoan";


interface LoanFormTableProps {
    loanId?: string; // ✅ new prop
    reloadFlag: number;
  }

export function LoanFormTable({ loanId, reloadFlag } : LoanFormTableProps) {
    const [loans, setLoans] = useState<EmployeeLoanList[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
      if (loanId) fetchLoans(loanId);
    }, [loanId, reloadFlag]);
  
    async function fetchLoans(id: string) {
      setIsLoading(true);
      try {
        const data = await getEmployeeLoan(id);
        setLoans(data);
      } finally {
        setIsLoading(false);
      }
    }
  
    if (!loanId) return null;
  
      
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