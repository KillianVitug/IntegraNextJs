import { db } from "@/db";
import { department, employeesGeneralInfo, payrollRunEmployees } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

export type EmployeeDepartmentMetadata = {
  departmentId: number | null;
  departmentName: string | null;
  departmentCode: string | null;
};

export const EMPTY_EMPLOYEE_DEPARTMENT: EmployeeDepartmentMetadata = {
  departmentId: null,
  departmentName: null,
  departmentCode: null,
};

type EmployeeDepartmentDatabase = Pick<typeof db, "select">;

export function getEmployeeDepartmentMetadata(
  departmentByEmployeeId: Map<string, EmployeeDepartmentMetadata> | undefined,
  employeeId: string
): EmployeeDepartmentMetadata {
  return departmentByEmployeeId?.get(employeeId) ?? EMPTY_EMPLOYEE_DEPARTMENT;
}

export async function loadEmployeeDepartmentMetadataByEmployeeId(
  employeeIds: string[],
  database: EmployeeDepartmentDatabase = db
): Promise<Map<string, EmployeeDepartmentMetadata>> {
  const uniqueEmployeeIds = [
    ...new Set(employeeIds.filter((employeeId) => employeeId.trim().length > 0)),
  ];

  if (uniqueEmployeeIds.length === 0) {
    return new Map();
  }

  const rows = await database
    .select({
      employeeId: employeesGeneralInfo.employeeId,
      departmentId: employeesGeneralInfo.departmentId,
      departmentName: department.name,
      departmentCode: department.code,
    })
    .from(employeesGeneralInfo)
    .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
    .where(inArray(employeesGeneralInfo.employeeId, uniqueEmployeeIds));

  return new Map(
    rows.map(
      (row: {
        employeeId: string;
        departmentId: number | null;
        departmentName: string | null;
        departmentCode: string | null;
      }) => [
        row.employeeId,
        {
          departmentId: row.departmentId ?? null,
          departmentName: row.departmentName ?? null,
          departmentCode: row.departmentCode ?? null,
        },
      ]
    )
  );
}

export async function loadEmployeeDepartmentMetadataByPayrollRunId(
  payrollRunId: string
): Promise<Map<string, EmployeeDepartmentMetadata>> {
  const employeeRows = await db
    .select({ employeeId: payrollRunEmployees.employeeId })
    .from(payrollRunEmployees)
    .where(eq(payrollRunEmployees.payrollRunId, payrollRunId));

  return loadEmployeeDepartmentMetadataByEmployeeId(
    employeeRows.map((r) => r.employeeId)
  );
}
