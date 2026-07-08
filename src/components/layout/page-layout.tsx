import * as React from "react";

import { cn } from "@/lib/utils";

type PageShellProps = {
  children: React.ReactNode;
  className?: string;
  size?: "default" | "wide" | "full";
};

const pageShellSizes: Record<NonNullable<PageShellProps["size"]>, string> = {
  default: "max-w-6xl",
  wide: "max-w-7xl",
  full: "max-w-none",
};

export function PageShell({
  children,
  className,
  size = "wide",
}: PageShellProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-4 px-4 py-4 sm:px-5 lg:px-6",
        pageShellSizes[size],
        className
      )}
    >
      {children}
    </div>
  );
}

type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

type FormGridProps = {
  children: React.ReactNode;
  className?: string;
  columns?: 1 | 2 | 3 | 4;
};

const formGridColumns: Record<NonNullable<FormGridProps["columns"]>, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

export function FormGrid({
  children,
  className,
  columns = 3,
}: FormGridProps) {
  return (
    <div
      className={cn(
        "grid items-start gap-x-4 gap-y-3",
        formGridColumns[columns],
        className
      )}
    >
      {children}
    </div>
  );
}

type FormActionsProps = {
  children: React.ReactNode;
  align?: "start" | "end" | "between";
  className?: string;
};

const formActionAlignment: Record<
  NonNullable<FormActionsProps["align"]>,
  string
> = {
  start: "justify-start",
  end: "justify-end",
  between: "justify-between",
};

export function FormActions({
  children,
  align = "end",
  className,
}: FormActionsProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 pt-2",
        formActionAlignment[align],
        className
      )}
    >
      {children}
    </div>
  );
}
