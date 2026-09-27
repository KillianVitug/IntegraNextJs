import { NextRequest } from "next/server";
import { saveBulkWeeklyScheduleFromRequest } from "../../form-handlers";

export async function POST(request: NextRequest) {
  return saveBulkWeeklyScheduleFromRequest(request);
}
