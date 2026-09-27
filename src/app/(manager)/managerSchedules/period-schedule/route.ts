import { NextRequest } from "next/server";
import { savePayrollPeriodScheduleFromRequest } from "../form-handlers";

export async function POST(request: NextRequest) {
  return savePayrollPeriodScheduleFromRequest(request);
}
