import { db } from "@/db";
import { employees } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

type GetEmployeeForUserArgs = {
  employeeId: string;
};

export async function getEmployeeForUser({ employeeId }: GetEmployeeForUserArgs) {
  return db.query.employees.findFirst({
    where: and(eq(employees.id, employeeId), isNull(employees.deletedAt)),
    with: {
      generalInfo: true,
      salary: true,
      otherReferences: true,
      timekeeping: true,
      recurringEntries: true,
    },
  });
}
