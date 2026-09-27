import { NextRequest } from "next/server";
import { cancelScheduleRequestFromRequest } from "../../form-handlers";

export async function POST(request: NextRequest) {
  return cancelScheduleRequestFromRequest(request);
}
