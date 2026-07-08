"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ReadOnlyFieldProps = {
  label: string;
  value?: string;
  className?: string;
  containerClassName?: string;
};

export function ReadOnlyField({
  label,
  value,
  className,
  containerClassName,
}: ReadOnlyFieldProps) {
  return (
    <div className={cn("space-y-1.5", containerClassName)}>
      <label className="text-sm font-medium">{label}</label>
      <div>
        <Input
          type="text"
          value={value ?? ""}
          readOnly
          className={cn("w-full min-w-0", className)}
        />
      </div>
    </div>
  );
}
