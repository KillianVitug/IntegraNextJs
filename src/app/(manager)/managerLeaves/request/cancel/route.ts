import { NextRequest } from "next/server";
import { cancelLeaveRequestFromRequest } from "../../form-handlers";

export async function POST(request: NextRequest) {
  return cancelLeaveRequestFromRequest(request);
}
