"use client";

import { useState } from "react";
import {
  Control,
  FieldValues,
  Path,
  useController,
  useWatch,
} from "react-hook-form";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Props<T extends FieldValues> = {
  fieldTitle: string;
  startName: Path<T>;
  endName: Path<T>;
  control: Control<T>;
  className?: string;
  containerClassName?: string;
};

export function DateRangeWithLabel<T extends FieldValues>({
  fieldTitle,
  startName,
  endName,
  control,
  className,
  containerClassName,
}: Props<T>) {
  const [open, setOpen] = useState(false);

  const startField = useController({ name: startName, control }).field;
  const endField = useController({ name: endName, control }).field;

  const startValue = useWatch({ control, name: startName }) as
    | string
    | undefined;
  const endValue = useWatch({ control, name: endName }) as string | undefined;

  const startDate = startValue ? new Date(startValue) : undefined;
  const endDate = endValue ? new Date(endValue) : undefined;

  const labelValue = startDate
    ? endDate
      ? `${format(startDate, "yyyy-MM-dd")} - ${format(endDate, "yyyy-MM-dd")}`
      : format(startDate, "yyyy-MM-dd")
    : "Pick a date range";

  return (
    <div className={cn("flex flex-col gap-1.5", containerClassName)}>
      <Label className="text-sm font-medium">{fieldTitle}</Label>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full min-w-0 justify-start text-left font-normal",
              className,
              !startDate && "text-muted-foreground"
            )}
          >
            {labelValue}
            <CalendarIcon className="ml-auto h-4 w-4 text-gray-500" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-auto overflow-hidden p-0" align="start">
          <Calendar
            className="rounded-md border shadow-sm"
            mode="range"
            captionLayout="dropdown"
            fromYear={1950}
            toYear={2050}
            selected={{ from: startDate, to: endDate }}
            onSelect={(range) => {
              const from = range?.from ? format(range.from, "yyyy-MM-dd") : "";
              const to = range?.to ? format(range.to, "yyyy-MM-dd") : "";

              startField.onChange(from);
              endField.onChange(to);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
