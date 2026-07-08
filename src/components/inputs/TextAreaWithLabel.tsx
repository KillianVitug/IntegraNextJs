"use client";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { TextareaHTMLAttributes } from "react";
import { useFormContext } from "react-hook-form";
import { cn } from "@/lib/utils";

type Props<S> = {
  fieldTitle: string;
  nameInSchema: keyof S & string;
  className?: string;
  containerClassName?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
} & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextAreaWithLabel<S>({
  fieldTitle,
  nameInSchema,
  className,
  containerClassName,
  value,
  onChange,
  ...props
}: Props<S>) {
  const form = useFormContext();

  const isControlled = typeof value !== "undefined" && typeof onChange === "function";

  if (isControlled) {
    return (
      <div className={cn("space-y-1.5", containerClassName)}>
        <label className="block text-sm font-medium" htmlFor={nameInSchema}>
          {fieldTitle}
        </label>
        <Textarea
          id={nameInSchema}
          value={value}
          onChange={onChange}
          className={className}
          {...props}
        />
      </div>
    );
  }

  // ?? Fallback to react-hook-form mode
  return (
    <FormField
      control={form.control}
      name={nameInSchema}
      render={({ field }) => (
        <FormItem className={cn("space-y-1.5", containerClassName)}>
          <FormLabel className="text-sm font-medium" htmlFor={nameInSchema}>
            {fieldTitle}
          </FormLabel>
          <FormControl>
            <Textarea
              id={nameInSchema}
              className={className}
              {...props}
              {...field}
              value={field.value ?? ""}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
