"use client";

import { Control, FieldValues, Path, Controller } from "react-hook-form";
import { FormControl,  FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";


type Props<T extends FieldValues> = {
  fieldTitle: string;
  nameInSchema: Path<T>;
  className?: string;
  containerClassName?: string;
  disabled?: boolean;
  control: Control<T>;
};

export function TimeWithLabel<T extends FieldValues>({
  fieldTitle,
  nameInSchema,
  className,
  containerClassName,
  disabled,
  control,
}: Props<T>) {
  return (
    <Controller
      name={nameInSchema}
      control={control}
      render={({ field }) => (
        <FormItem className={cn("space-y-1.5", containerClassName)}>
          <FormLabel className="text-sm font-medium" htmlFor={nameInSchema}>
            {fieldTitle}
          </FormLabel>

          <FormControl>
            <Input
              id={nameInSchema}
              className={cn("w-full min-w-0", className)}
              type="time"
              value={field.value || ""}
              onChange={(e) => field.onChange(e.target.value)}
              disabled={disabled}
            />
          </FormControl>

          <FormMessage />
        </FormItem>
      )}
    />
  );
}
