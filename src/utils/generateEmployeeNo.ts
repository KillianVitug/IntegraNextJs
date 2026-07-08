// /utils/generateEmployeeNo.ts
import { type SQL, sql } from "drizzle-orm";
import { formatNextEmployeeNoFromMax } from "@/utils/employeeNo";
import { type EmployeeType } from "@/utils/employeeCode";

type EmployeeNoRow = {
  employee_no: string | null;
};

type EmployeeNoTransaction = {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
};

export async function generateEmployeeNoTx(
  tx: EmployeeNoTransaction,
  employeeType: EmployeeType,
) {
  const advisoryLockKey = `employees_employee_no_generation_${employeeType}`;

  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext(${advisoryLockKey}))
  `);

  const result = await tx.execute(sql`
    SELECT employee_no
    FROM employees
    WHERE employee_type = ${employeeType}
      AND employee_no ~ '^[0-9]+$'
    ORDER BY CAST(employee_no AS NUMERIC) DESC
    LIMIT 1
    FOR UPDATE
  `);

  const last = (result.rows[0] as EmployeeNoRow | undefined)?.employee_no ?? null;
  return formatNextEmployeeNoFromMax(last);
}
