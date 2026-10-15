import { rejectManagerAttendanceMutationRequest } from "@/lib/auth/manager-attendance-mutations";

// Legacy bookmarks and direct POSTs remain denied at the server boundary.
export async function POST() {
  return rejectManagerAttendanceMutationRequest();
}
