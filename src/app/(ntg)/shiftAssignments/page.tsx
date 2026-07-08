import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employeeShiftAssignments, employees } from "@/db/schema";
import { requireAdminActor } from "@/lib/admin";
import { Button } from "@/components/ui/button";
import { ShiftAssignmentManager } from "./ShiftAssignmentManager";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";

export const metadata = {
  title: "Shift Overrides",
};

function buildEmployeeLabel(args: {
  employeeNo: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
}) {
  return `${formatEmployeeNoDisplay(args.employeeNo)} | ${args.lastName}, ${args.firstName}${
    args.middleName ? ` ${args.middleName}` : ""
  }`;
}

export default async function ShiftAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ employeeId?: string }>;
}) {
  await requireAdminActor();
  const params = await searchParams;
  const employeeId = params.employeeId ?? null;

  if (!employeeId) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-bold">Shift Overrides</h1>
        <p className="text-sm text-muted-foreground">
          Open this page from an employee record to manage temporary date-based shift overrides.
        </p>
        <Button asChild variant="outline">
          <Link href="/employeeMaster">Open Employee Master</Link>
        </Button>
      </div>
    );
  }

  const [employee, assignments] = await Promise.all([
    db.query.employees.findFirst({
      where: eq(employees.id, employeeId),
    }),
    db
      .select()
      .from(employeeShiftAssignments)
      .where(eq(employeeShiftAssignments.employeeId, employeeId)),
  ]);

  if (!employee) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-bold">Shift Overrides</h1>
        <p className="text-sm text-muted-foreground">Employee not found.</p>
        <Button asChild variant="outline">
          <Link href="/employeeMaster">Back to Employee Master</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Shift Overrides</h1>
          <p className="text-sm text-muted-foreground">
            {buildEmployeeLabel(employee)}
          </p>
          <p className="text-sm text-muted-foreground">
            Overrides take priority over the employee's weekly schedule for the covered dates.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/employeeMaster/form?employeeId=${employee.id}`}>Back to Employee</Link>
        </Button>
      </div>

      <ShiftAssignmentManager
        employeeId={employee.id}
        employeeLabel={buildEmployeeLabel(employee)}
        initialAssignments={assignments.map((row) => ({
          ...row,
          shiftTableId: row.shiftTableId,
          breakMinutes: row.breakMinutes,
          paidBreakMinutes: row.paidBreakMinutes,
          graceMinutes: row.graceMinutes,
          hoursPerDay: row.hoursPerDay,
        }))}
      />
    </div>
  );
}
