import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employeeWeeklyShiftPatterns, employees } from "@/db/schema";
import { requireAdminActor } from "@/lib/admin";
import { Button } from "@/components/ui/button";
import { WeeklyShiftPatternManager } from "./WeeklyShiftPatternManager";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";

export const metadata = {
  title: "Weekly Shift Patterns",
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

export default async function WeeklyShiftPatternsPage({
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
        <h1 className="text-2xl font-bold">Weekly Shift Patterns</h1>
        <p className="text-sm text-muted-foreground">
          Open this page from an employee record to manage the employee's normal weekly
          schedule.
        </p>
        <Button asChild variant="outline">
          <Link href="/employeeMaster">Open Employee Master</Link>
        </Button>
      </div>
    );
  }

  const [employee, patterns] = await Promise.all([
    db.query.employees.findFirst({
      where: eq(employees.id, employeeId),
    }),
    db.query.employeeWeeklyShiftPatterns.findMany({
      where: eq(employeeWeeklyShiftPatterns.employeeId, employeeId),
      with: {
        days: true,
      },
    }),
  ]);

  if (!employee) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-bold">Weekly Shift Patterns</h1>
        <p className="text-sm text-muted-foreground">Employee not found.</p>
        <Button asChild variant="outline">
          <Link href="/employeeMaster">Back to Employee Master</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Weekly Shift Patterns</h1>
          <p className="text-sm text-muted-foreground">
            {buildEmployeeLabel(employee)}
          </p>
          <p className="text-sm text-muted-foreground">
            Use this page for the employee's normal Monday-Sunday schedule. Use Shift
            Overrides only for temporary date-based changes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/shiftAssignments?employeeId=${employee.id}`}>Open Shift Overrides</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/employeeMaster/form?employeeId=${employee.id}`}>Back to Employee</Link>
          </Button>
        </div>
      </div>

      <WeeklyShiftPatternManager
        employeeId={employee.id}
        employeeLabel={buildEmployeeLabel(employee)}
        initialPatterns={patterns.map((pattern) => ({
          ...pattern,
          days: [...pattern.days],
        }))}
      />
    </div>
  );
}
