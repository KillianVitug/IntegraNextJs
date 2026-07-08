import { ReactNode } from "react";
import { requireManager } from "@/lib/auth/server";
import { SideBar, SidebarItem } from "@/components/SideBar";
import { PageShell } from "@/components/layout/page-layout";
import { connection } from "next/server";

const sidebarItems: SidebarItem[] = [
  { label: "Dashboard", href: "/managerHome", icon: "home" },
  { label: "Calendar", href: "/managerCalendar", icon: "calendar" },
  { label: "Leave Requests", href: "/managerLeaves", icon: "calendar" },
  { label: "Schedules", href: "/managerSchedules", icon: "file" },
  { label: "DTR Files", href: "/managerDtrFiles", icon: "file" },
];

export default async function ManagerLayout({ children }: { children: ReactNode }) {
  await connection();
  const auth = await requireManager({ redirectTo: "/" });
  const userLabel =
    [auth.employeeFirstName, auth.employeeLastName].filter(Boolean).join(" ") ||
    auth.email;

  return (
    <div className="flex h-screen">
      <SideBar items={sidebarItems} userLabel={userLabel} showLogout />
      <main className="min-w-0 flex-1 overflow-auto">
        <PageShell size="full">{children}</PageShell>
      </main>
    </div>
  );
}
