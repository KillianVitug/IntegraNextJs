"use client";

import { useState, useEffect, useCallback } from "react";
import DepartmentCodeForm from "./DepartmentCodeForm";
import DepartmentTable from "./DepartmentTable";
import { SelectDepartmentSchemaType } from "@/zod-schemas/department";

export default function DepartmentPage() {
  const [departments, setDepartments] = useState<SelectDepartmentSchemaType[]>([]);
  const [selected, setSelected] = useState<SelectDepartmentSchemaType | null>(null);
  

  // 🔹 Fetcher function
  const loadDepartments = useCallback(async () => {
    const res = await fetch("/api/constants/department");
    const data = await res.json();
    setDepartments(data);
  }, []);

  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  return (
    <div className="flex flex-col gap-8">
      <DepartmentCodeForm
        selectedDepartment={selected}
        onResetSelection={() => setSelected(null)}
        onRefresh={loadDepartments} // 🔹 new
      />
      <DepartmentTable
        departments={departments}
        onRowSelect={(dept) => setSelected(dept)}
      />
    </div>
  );
}
