
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  FileText,
  LayoutDashboard,
  Sparkles,
  UsersRound,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Home",
};

const quickLinks = [
  {
    title: "Dashboard",
    href: "/home/dashboard",
    description:
      "Review payroll activity, staffing totals, attendance imports, and upcoming payroll periods.",
    icon: LayoutDashboard,
  },
  {
    title: "Leave Requests",
    href: "/home/leaves",
    description:
      "Track pending requests and monitor approved absences that affect staffing this week and next month.",
    icon: FileText,
  },
  {
    title: "Applications",
    href: "/home/applications",
    description:
      "Keep the applications workspace within reach while the rest of the admin home area fills out.",
    icon: Sparkles,
  },
  {
    title: "Employee Departments",
    href: "/home/departments",
    description:
      "View department distribution, spot unassigned employees, and understand workforce coverage.",
    icon: Building2,
  },
];

export default function Home() {
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border bg-gradient-to-br from-slate-950 via-slate-900 to-sky-900 text-white shadow-lg">
        <div className="grid gap-8 p-8 lg:grid-cols-[1.5fr_1fr] lg:p-10">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1 text-sm">
              <UsersRound className="h-4 w-4" />
              Integra HRMS And Payroll
            </div>
            <div className="space-y-3">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
                Centralize payroll, leave review, and department visibility in
                one admin workspace.
              </h1>
              <p className="max-w-2xl text-base text-slate-200 sm:text-lg">
                Integra keeps the core HR operations flow close at hand so you
                can move from workforce overview to leave approvals and payroll
                readiness without jumping between disconnected screens.
              </p>
            </div>
          </div>

          <div className="grid gap-4 rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-300">
                Core focus
              </p>
              <p className="mt-2 text-xl font-semibold">Daily HR operations</p>
            </div>
            <div className="grid gap-3 text-sm text-slate-200">
              <div className="rounded-xl bg-black/20 px-4 py-3">
                Review workforce signals before payroll cutoffs.
              </div>
              <div className="rounded-xl bg-black/20 px-4 py-3">
                Surface pending leave requests for faster action.
              </div>
              <div className="rounded-xl bg-black/20 px-4 py-3">
                Monitor department distribution and staffing gaps.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Admin Shortcuts
          </h2>
          <p className="text-sm text-muted-foreground">
            Start from the area that needs attention today.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {quickLinks.map((link) => {
            const Icon = link.icon;

            return (
              <Link key={link.href} href={link.href} className="group block">
                <Card className="h-full border-border/80 transition hover:-translate-y-1 hover:border-sky-500/50 hover:shadow-lg">
                  <CardHeader className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="rounded-xl bg-sky-50 p-3 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                        <Icon className="h-5 w-5" />
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-foreground" />
                    </div>
                    <div className="space-y-1">
                      <CardTitle>{link.title}</CardTitle>
                      <CardDescription>{link.description}</CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <span className="text-sm font-medium text-sky-700 dark:text-sky-300">
                      Open workspace
                    </span>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
