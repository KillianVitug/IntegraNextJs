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

type Props<T extends FieldValues> = {
  fieldTitle: string;
  nameInSchema: Path<T>;
  register: UseFormRegister<T>;
  control: Control<T>;       // 🔥 REQUIRED
  type?: string;
  className?: string;
  readOnly?: boolean;

  value?: string | number | undefined;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
} & InputHTMLAttributes<HTMLInputElement>;

export function InputWithLabelForFiles<T extends FieldValues>({
  fieldTitle,
  nameInSchema,
  register,
  control,       // ← FIX
  type = "text",
  className,
  readOnly,
  value,
  onChange,
  ...props
}: Props<T>) {

  const inputProps = register(nameInSchema);

  return (
    <FormField
      control={control}           // ← FIX
      name={nameInSchema}
      render={({ field }) => (    // 🔥 receives RHF-controlled field
        <FormItem>
          <FormLabel className="text-base" htmlFor={nameInSchema}>
            {fieldTitle}
          </FormLabel>

          <FormControl>
            <Input
              id={nameInSchema}
              type={type}
              readOnly={readOnly}
              className={`${className}`}
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
