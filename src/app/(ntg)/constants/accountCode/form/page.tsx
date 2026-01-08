"use client";

import { useState, useEffect, useCallback } from "react";
import AccountCodeForm from "./AccountCodeForm";
import AccountCodeTable from "./AccountCodeTable";
import { SelectAccountCodeSchemaType } from "@/zod-schemas/accountCode";


export default function AccountCodePage() {
    const [accountCode, setaccountCode] = useState<SelectAccountCodeSchemaType[]>([]);
    const [selected, setSelected] = useState<SelectAccountCodeSchemaType | null>(null);

      // 🔹 Fetcher function
    const loadAccountCode = useCallback(async () => {
        const res = await fetch("/api/constants/accountCode");
        const data = await res.json();
        setaccountCode(data);
    }, []);

    useEffect(() => {
        loadAccountCode();
    }, [loadAccountCode]);

    return (
        <div className="flex flex-col gap-8">
          <AccountCodeForm
            selectedAccountCode={selected}
            onResetSelection={() => setSelected(null)}
            onRefresh={loadAccountCode} // 🔹 new
          />
          <AccountCodeTable
            accountCode={accountCode}
            onRowSelect={(row) => setSelected(row)}
          />
        </div>
      );
    }