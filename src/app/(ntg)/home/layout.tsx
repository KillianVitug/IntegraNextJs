import { ReactNode } from "react";
import { SideBar, SidebarItem } from "@/components/SideBar";
import { getCurrentAuthContext, requireAdmin } from "@/lib/auth/server";
import { getEmployeeDisplayNameForUser } from "@/lib/queries/getEmployeeDisplayNameForUser";

const sidebarItems: SidebarItem[] = [
  { label: "Dashboard", href: "/home/dashboard", icon: "home" },
  { label: "Leave Requests", href: "/home/leaves", icon: "calendar" },
  { label: "Schedule Request", href: "/home/schedule-requests", icon: "file" },
  { label: "Applications", href: "/home/applications", icon: "file" },
  { label: "Employee Departments", href: "/home/departments", icon: "building" },
];

function formatFullName(firstName?: string | null, lastName?: string | null) {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

export default async function HomeLayout({ children }: { children: ReactNode }) {
  await requireAdmin({ redirectTo: "/" });
  const auth = await getCurrentAuthContext();

  const employeeDisplayName = auth
    ? await getEmployeeDisplayNameForUser({
        employeeId: auth.employeeId,
      })
    : null;

  const userLabel =
    formatFullName(
      employeeDisplayName?.firstName,
      employeeDisplayName?.lastName,
    ) ||
    formatFullName(auth?.employeeFirstName, auth?.employeeLastName) ||
    auth?.email ||
    undefined;

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      <SideBar items={sidebarItems} userLabel={userLabel} />
      <main className="flex-1 overflow-auto p-4">{children}</main>
    </div>
  );
}
