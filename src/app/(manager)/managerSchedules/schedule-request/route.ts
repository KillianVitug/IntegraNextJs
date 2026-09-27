import { NextRequest } from "next/server";
import { saveScheduleRequestFromRequest } from "../form-handlers";

export async function POST(request: NextRequest) {
  return saveScheduleRequestFromRequest(request);
}
