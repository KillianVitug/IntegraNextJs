import { NextResponse } from "next/server";
import {
  fetchHolidayCalendar,
  fetchHolidayTemplates,
} from "@/lib/queries/fetchLookupData";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const selectedYear = Number.isInteger(year) ? year : undefined;
  const [holidayRows, templateRows] = await Promise.all([
    fetchHolidayCalendar(selectedYear),
    fetchHolidayTemplates(),
  ]);

  return NextResponse.json({ holidayRows, templateRows }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
