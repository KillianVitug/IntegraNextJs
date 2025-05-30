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

type Props<S> = {
  fieldTitle: string;
  nameInSchema: keyof S & string;
  className?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
} & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextAreaWithLabel<S>({
  fieldTitle,
  nameInSchema,
  className,
  value,
  onChange,
  ...props
}: Props<S>) {
  const form = useFormContext();

  const isControlled = typeof value !== "undefined" && typeof onChange === "function";

  if (isControlled) {
    // ?? Use as a controlled input, outside react-hook-form
    return (
      <div className="space-y-1.5">
        <FormLabel className="text-base mb-2" htmlFor={nameInSchema}>
          {fieldTitle}
        </FormLabel>
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
        <FormItem>
          <FormLabel className="text-base mb-2" htmlFor={nameInSchema}>
            {fieldTitle}
          </FormLabel>
          <FormControl>
            <Textarea id={nameInSchema} className={className} {...props} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
