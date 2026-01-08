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

type Props<T extends FieldValues = FieldValues> = {
  fieldTitle: string;

  // 👇 typed + legacy-safe
  nameInSchema: Path<T> | (string & {});
  onCheckedChange?: (value: boolean) => void;
  message?: string;
  disabled?: boolean;
};

export function CheckboxWithLabel<T extends FieldValues = FieldValues>({
  fieldTitle,
  nameInSchema,
  message,
  disabled = false,
  onCheckedChange,
}: Props<T>) {
  const form = useFormContext<T>();

  return (
    <FormField
      control={form.control}
      name={nameInSchema as Path<T>}
      render={({ field }) => (
        <FormItem className="w-full flex items-center gap-2">
          <FormLabel
            className="text-base w-full mt-2"
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
