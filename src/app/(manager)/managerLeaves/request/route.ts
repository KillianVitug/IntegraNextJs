import { NextRequest } from "next/server";
import { saveLeaveRequestFromRequest } from "../form-handlers";

export async function POST(request: NextRequest) {
  return saveLeaveRequestFromRequest(request);
}
