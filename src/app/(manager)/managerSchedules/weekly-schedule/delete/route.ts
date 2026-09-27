import { NextRequest } from "next/server";
import { deleteWeeklyScheduleFromRequest } from "../../form-handlers";

export async function POST(request: NextRequest) {
  return deleteWeeklyScheduleFromRequest(request);
}
