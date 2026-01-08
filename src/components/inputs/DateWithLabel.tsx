import {  Control, Controller, useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useState } from "react";
type Props = {
  fieldTitle: string;
  nameInSchema: string;
  control?: Control<any>;
  value?: string;
  
  onChange?: (val: string) => void;
};

export function DateWithLabel({ fieldTitle, nameInSchema, control, value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const selectedDate = value && value !== "null" ? new Date(value) : undefined;

  if (control) {
    return (
      <div className="flex flex-col gap-2">
        <Label className="text-base" htmlFor={nameInSchema}>
          {fieldTitle}
        </Label>
        <Controller
          name={nameInSchema}
          control={control}
          render={({ field }) => (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full max-w-xs justify-start text-left font-normal",
                    !field.value && "text-muted-foreground"
                  )}
                >
                  {field.value ? format(new Date(field.value), "yyyy-MM-dd") : "Pick a date"}
                  <CalendarIcon className="ml-auto h-4 w-4 text-gray-500" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto overflow-hidden p-0" align="start">
              <Calendar
                className="rounded-md border shadow-sm"
                mode="single"
                captionLayout="dropdown"   // 👈 Enable month/year dropdowns
                fromYear={1950}            // 👈 Start year
                toYear={2050}              // 👈 End year
                selected={field.value ? new Date(field.value) : undefined}
                onSelect={(date) => {
                  field.onChange(date ? format(date, "yyyy-MM-dd") : "");
                  setOpen(false);
                }}
                initialFocus
              />
              </PopoverContent>
            </Popover>
          )}
        />
      </div>
    );
  }

  // Controlled version
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-base" htmlFor={nameInSchema}>
        {fieldTitle}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full max-w-xs justify-start text-left font-normal",
              !value && "text-muted-foreground"
            )}
          >
            {selectedDate ? format(selectedDate, "yyyy-MM-dd") : "Pick a date"}
            <CalendarIcon className="ml-auto h-4 w-4 text-gray-500" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="p-0">
          <Calendar
            className="!w-auto"
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              onChange?.(date ? format(date, "yyyy-MM-dd") : "");
              setOpen(false);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
