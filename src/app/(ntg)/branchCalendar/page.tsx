import { PageHeader } from "@/components/layout/page-layout";
import { getBranchCalendarMonth } from "@/lib/queries/branchCalendar";
import { BranchCalendarClient } from "./BranchCalendarClient";

export const metadata = {
  title: "Branch Calendar",
};

function readYear(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2100
    ? parsed
    : fallback;
}

function readMonth(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12
    ? parsed
    : fallback;
}

function readDepartmentId(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function BranchCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    month?: string;
    day?: string;
    departmentId?: string;
  }>;
}) {
  const params = await searchParams;
  const now = new Date();
  const year = readYear(params.year, now.getFullYear());
  const month = readMonth(params.month, now.getMonth() + 1);
  const departmentId = readDepartmentId(params.departmentId);
  const calendarMonth = await getBranchCalendarMonth({
    year,
    month,
    departmentId,
  });
  const selectedDate =
    params.day && calendarMonth.days.some((day) => day.date === params.day)
      ? params.day
      : calendarMonth.days[0]?.date ?? "";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Branch Calendar"
        description="Review schedules, approved leaves, and confirmed holidays across departments."
      />

      <BranchCalendarClient
        data={calendarMonth}
        initialSelectedDate={selectedDate}
      />
    </div>
  );
}
