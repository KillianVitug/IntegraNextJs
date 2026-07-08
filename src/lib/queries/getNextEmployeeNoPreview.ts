"use server";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { formatNextEmployeeNoFromMax } from "@/utils/employeeNo";
import { type EmployeeType } from "@/utils/employeeCode";

type EmployeeNoRow = {
  employee_no: string | null;
};

export async function getNextEmployeeNoPreview(employeeType: EmployeeType) {
  const result = await db.execute(sql`
    SELECT employee_no
    FROM employees
    WHERE employee_type = ${employeeType}
      AND employee_no ~ '^[0-9]+$'
    ORDER BY CAST(employee_no AS NUMERIC) DESC
    LIMIT 1
  `);

  const last = (result.rows[0] as EmployeeNoRow | undefined)?.employee_no ?? null;
  return formatNextEmployeeNoFromMax(last);
}
