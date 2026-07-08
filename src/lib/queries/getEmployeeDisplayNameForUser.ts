import { db } from "@/db";
import { employees } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

type GetEmployeeDisplayNameForUserArgs = {
  employeeId: string;
};

type EmployeeDisplayName = {
  firstName: string;
  lastName: string;
};

export async function getEmployeeDisplayNameForUser({
  employeeId,
}: GetEmployeeDisplayNameForUserArgs): Promise<EmployeeDisplayName | null> {
  const employee = await db.query.employees.findFirst({
    columns: {
      firstName: true,
      lastName: true,
    },
    where: and(eq(employees.id, employeeId), isNull(employees.deletedAt)),
  });

  return employee ?? null;
}
