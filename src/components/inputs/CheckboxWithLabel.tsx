"use client";

import {
  FieldValues,
  Path,
  useFormContext,
} from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Props<T extends FieldValues = FieldValues> = {
  fieldTitle: string;

  // 👇 typed + legacy-safe
  nameInSchema: Path<T> | (string & {});
  onCheckedChange?: (value: boolean) => void;
  message?: string;
  disabled?: boolean;
  className?: string;
};

export function CheckboxWithLabel<T extends FieldValues = FieldValues>({
  fieldTitle,
  nameInSchema,
  message,
  disabled = false,
  onCheckedChange,
  className,
}: Props<T>) {
  const form = useFormContext<T>();

  return (
    <FormField
      control={form.control}
      name={nameInSchema as Path<T>}
      render={({ field }) => (
        <FormItem
          className={cn("flex w-full items-center gap-2 space-y-0", className)}
        >
          <FormLabel
            className="w-full text-sm font-medium"
            htmlFor={String(nameInSchema)}
          >
            {fieldTitle}
          </FormLabel>

          <div className="flex items-center gap-2">
            <FormControl>
              <Checkbox
                id={String(nameInSchema)}
                checked={!!field.value}
                onCheckedChange={(checked) => {
                  field.onChange(checked);      // ✅ RHF state
                  onCheckedChange?.(!!checked); // ✅ custom logic
                }}
                disabled={disabled}
              />
            </FormControl>

            {message && <span>{message}</span>}
          </div>

          <FormMessage />
        </FormItem>
      )}
    />
  );
}
