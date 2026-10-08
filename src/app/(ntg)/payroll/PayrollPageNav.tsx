"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAYROLL_SECTION_PATHS, type PayrollSection } from "./sections";

const PAYROLL_PAGE_LINKS: Array<{ section: PayrollSection; label: string }> = [
  { section: "run", label: "Workshop" },
  { section: "report", label: "Report" },
  { section: "outputs", label: "Outputs" },
  { section: "specialRun", label: "Special Run" },
];

type Props = {
  activeSection: PayrollSection;
  title: string;
  description: string;
  periodCode?: string | null;
  runLabel?: string | null;
};

export function PayrollPageNav({
  activeSection,
  title,
  description,
  periodCode,
  runLabel,
}: Props) {
  const searchParams = useSearchParams();

  function getHref(section: PayrollSection) {
    const queryString = searchParams.toString();
    const path = PAYROLL_SECTION_PATHS[section];
    return queryString ? `${path}?${queryString}` : path;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {description}
          </p>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border px-2 py-1">
              Period: {periodCode ?? "Not selected"}
            </span>
            <span className="rounded-md border px-2 py-1">
              Run: {runLabel ?? "No run"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {PAYROLL_PAGE_LINKS.map((item) => (
          <Button
            key={item.section}
            asChild
            variant={item.section === activeSection ? "default" : "outline"}
            size="sm"
            className={cn(item.section === activeSection && "pointer-events-none")}
          >
            <Link href={getHref(item.section)}>{item.label}</Link>
          </Button>
        ))}
        <Button asChild variant="outline" size="sm"><Link href={`/payroll/provisional?${new URLSearchParams([...searchParams.entries()].filter(([key]) => ["year", "periodId", "group"].includes(key)))}`}>Provisional payroll</Link></Button>
      </div>
    </div>
  );
}
