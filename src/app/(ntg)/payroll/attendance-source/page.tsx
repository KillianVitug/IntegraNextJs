import { requireAdminActor } from "@/lib/admin";
import { AttendanceRouteRedirect } from "./route-redirect";
/** Compatibility entry point. The client retains old fragment-only bookmarks. */
export default async function AttendanceSourcePage() {
 await requireAdminActor();
 return <AttendanceRouteRedirect/>;
}
