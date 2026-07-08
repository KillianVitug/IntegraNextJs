"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logoutAction } from "@/app/actions/authAction";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  PanelLeft,
  Calendar,
  FileText,
  Building2,
  LayoutDashboardIcon,
  LogOut,
} from "lucide-react";

const iconMap = {
  home: LayoutDashboardIcon,
  calendar: Calendar,
  file: FileText,
  building: Building2,
};

export type SidebarItem = {
  label: string;
  href?: string;
  icon?: string;
  children?: { label: string; href: string }[];
};

type Props = {
  items: SidebarItem[];
  userLabel?: string;
  showLogout?: boolean;
};

export function SideBar({ items, userLabel, showLogout = false }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="app-sidebar-shell flex h-full">
      <input
        id="app-sidebar-toggle"
        type="checkbox"
        className="app-sidebar-toggle sr-only"
        checked={collapsed}
        onChange={(event) => setCollapsed(event.target.checked)}
        aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
      />
      <aside
        className={cn(
          "app-sidebar flex h-full flex-col overflow-hidden border-r transition-all duration-300",
          collapsed ? "w-14" : "w-60",
        )}
      >
        <div className="flex flex-1 flex-col gap-1.5 px-2 py-2">
          {items.map((item) => {
            const Icon = item.icon
              ? iconMap[item.icon as keyof typeof iconMap]
              : null;

            if (item.children) {
              return (
                <DropdownMenu key={item.label}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between"
                    >
                      <div className="flex items-center gap-2">
                        {Icon && <Icon className="h-4 w-4" />}
                        <span className="app-sidebar-label">
                          {!collapsed && item.label}
                        </span>
                      </div>

                      <ChevronDown className="app-sidebar-label h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent align="start">
                    {item.children.map((child) => (
                      <DropdownMenuItem key={child.href} asChild>
                        <Link href={child.href}>{child.label}</Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }

            return (
              <Button
                key={item.href}
                asChild
                variant={pathname === item.href ? "default" : "ghost"}
                size="sm"
                className="w-full justify-start"
              >
                <Link href={item.href!} className="w-full">
                  <div className="flex items-center gap-2">
                    {Icon && <Icon className="h-4 w-4" />}
                    <span className="app-sidebar-label">
                      {!collapsed && item.label}
                    </span>
                  </div>
                </Link>
              </Button>
            );
          })}

          {showLogout && (
            <form action={logoutAction} className="mt-auto">
              <Button
                variant="ghost"
                aria-label="LogOut"
                title="LogOut"
                size="sm"
                className="w-full justify-start"
                type="submit"
              >
                <div className="flex items-center gap-2">
                  <LogOut className="h-4 w-4" />
                  <span className="app-sidebar-label">
                    {!collapsed && "Logout"}
                  </span>
                </div>
              </Button>
            </form>
          )}
        </div>

        <div className="mt-auto border-t p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="app-sidebar-label truncate text-sm font-medium">
              {!collapsed && (userLabel ?? "Unknown user")}
            </span>
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-9 w-9"
            >
              <label
                htmlFor="app-sidebar-toggle"
                className="app-sidebar-toggle-label cursor-pointer"
                title={collapsed ? "Show sidebar" : "Hide sidebar"}
                aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
              >
                <PanelLeft
                  className={`app-sidebar-toggle-icon h-4 w-4 transition-transform ${
                    collapsed ? "rotate-180" : ""
                  }`}
                />
              </label>
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
