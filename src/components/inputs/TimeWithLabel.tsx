"use client";

import { Controller } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

type Props = {
  fieldTitle: string;
  nameInSchema: string;
  className?: string;
  disabled?: boolean;
  control?: any; // Accepting control as a prop
};

export function TimeWithLabel({ fieldTitle, nameInSchema, className, disabled, control }: Props) {
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
