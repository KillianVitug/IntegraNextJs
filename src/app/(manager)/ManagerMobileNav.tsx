"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  FileText,
  LayoutDashboardIcon,
  ListChecks,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";

const managerNavItems = [
  { label: "Home", href: "/managerHome", icon: LayoutDashboardIcon },
  { label: "Calendar", href: "/managerCalendar", icon: Calendar },
  { label: "Leaves", href: "/managerLeaves", icon: ListChecks },
  { label: "Schedules", href: "/managerSchedules", icon: FileText },
  { label: "DTR", href: "/managerDtrFiles", icon: Upload },
];

export function ManagerMobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.10)] backdrop-blur md:hidden"
      aria-label="Manager mobile navigation"
    >
      <div className="grid grid-cols-5 gap-1">
        {managerNavItems.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] font-medium text-muted-foreground transition-colors",
                active && "bg-primary text-primary-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
