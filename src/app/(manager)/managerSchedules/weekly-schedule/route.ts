import { NextRequest } from "next/server";
import { saveWeeklyScheduleFromRequest } from "../form-handlers";

export async function POST(request: NextRequest) {
  return saveWeeklyScheduleFromRequest(request);
}
