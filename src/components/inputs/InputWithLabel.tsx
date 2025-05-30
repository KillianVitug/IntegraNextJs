"use client";

import { UseFormRegister } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputHTMLAttributes } from "react";
type Props<S> = {
  fieldTitle: string;
  nameInSchema: keyof S & string;
  register?: UseFormRegister<any>;
  type?: string;
  className?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
} & InputHTMLAttributes<HTMLInputElement>;

export function InputWithLabel<S>({
  fieldTitle,
  nameInSchema,
  register,
  type = "text",
  className,
  value,
  onChange,
  ...props
}: Props<S>) {
  const inputProps = register
    ? {
        ...register(nameInSchema, {
          ...(type === "number"
            ? {
                setValueAs: (v) => (v === "" || v === null || v === undefined ? 0 : Number(v)),
              }
            : {}),
        }),
      }
    : {
        value,
        onChange,
      };

  return (
    <FormField
      name={nameInSchema}
      render={() => (
        <FormItem>
          <FormLabel className="text-base" htmlFor={nameInSchema}>
            {fieldTitle}
          </FormLabel>
          <FormControl>
            <Input
              type={type}
              id={nameInSchema}
              className={`w-full max-w-xs disabled:text-blue-500 dark:disabled:text-green-500 disabled:opacity-75 ${className}`}
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
