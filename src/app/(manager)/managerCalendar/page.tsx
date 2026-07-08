import { getManagerCalendarMonth } from "@/app/actions/managerAction";
import { PageHeader } from "@/components/layout/page-layout";
import { ManagerCalendarClient } from "./ManagerCalendarClient";

export const metadata = {
  title: "Manager Calendar",
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

export default async function ManagerCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; day?: string }>;
}) {
  const params = await searchParams;
  const now = new Date();
  const year = readYear(params.year, now.getFullYear());
  const month = readMonth(params.month, now.getMonth() + 1);
  const calendarMonth = await getManagerCalendarMonth({ year, month });
  const selectedDate =
    params.day && calendarMonth.days.some((day) => day.date === params.day)
      ? params.day
      : calendarMonth.days[0]?.date ?? "";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Manager Calendar"
        description="Department schedules and approved schedule overrides by day."
      />

      <ManagerCalendarClient
        data={calendarMonth}
        initialSelectedDate={selectedDate}
      />
    </div>
  );
}
