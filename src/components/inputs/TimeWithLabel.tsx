"use client";

import { Control, FieldValues, Path, Controller } from "react-hook-form";
import { FormControl,  FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";


type Props<T extends FieldValues> = {
  fieldTitle: string;
  nameInSchema: Path<T>;
  className?: string;
  disabled?: boolean;
  control: Control<T>;
};

export function TimeWithLabel<T extends FieldValues>({
  fieldTitle,
  nameInSchema,
  className,
  disabled,
  control,
}: Props<T>) {
  return (
    <Controller
      name={nameInSchema}
      control={control}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-base mb-2" htmlFor={nameInSchema}>
            {fieldTitle}
          </FormLabel>

          <FormControl>
            <Input
              id={nameInSchema}
              className={`w-full max-w-xs ${className}`}
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
