"use client";

import { FieldValues, Path, UseFormRegister, Control } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props<T extends FieldValues> = {
  fieldTitle: string;
  nameInSchema: Path<T>;
  register: UseFormRegister<T>;
  control: Control<T>;
  type?: string;
  className?: string;
  containerClassName?: string;
  readOnly?: boolean;
  value?: string | number | undefined;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
} & InputHTMLAttributes<HTMLInputElement>;

export function InputWithLabelForFiles<T extends FieldValues>({
  fieldTitle,
  nameInSchema,
  register,
  control,
  type = "text",
  className,
  containerClassName,
  readOnly,
  ...props
}: Props<T>) {
  const inputProps = register(nameInSchema);

  return (
    <FormField
      control={control}
      name={nameInSchema}
      render={() => (
        <FormItem className={cn("space-y-1.5", containerClassName)}>
          <FormLabel className="text-sm font-medium" htmlFor={nameInSchema}>
            {fieldTitle}
          </FormLabel>

          <FormControl>
            <Input
              id={nameInSchema}
              type={type}
              readOnly={readOnly}
              className={cn("w-full min-w-0", className)}
              {...props}
              {...inputProps}
            />
          </FormControl>

          <FormMessage />
        </FormItem>
      )}
    />
  );
}
