"use client";

import {
  UseFormRegister,
  Path,
  FieldValues,
} from "react-hook-form";
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

type Props<T extends FieldValues = FieldValues> = {
  fieldTitle: string;
  nameInSchema: Path<T> | (string & {});
  register?: UseFormRegister<T>;
  type?: string;
  className?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  readOnly?: boolean;
  containerClassName?: string;
} & InputHTMLAttributes<HTMLInputElement>;
import { stripCommas } from "@/lib/number"; 

export function formatMoney(v: string) {
  if (!v) return "0";
  const raw = stripCommas(v).trim();
  if (!/^\d*\.?\d*$/.test(raw) || raw === ".") return "0";

  const hasDecimal = raw.includes(".");
  const [wholeValue, decimalValue = ""] = raw.split(".");
  const whole = wholeValue === "" ? "0" : wholeValue;
  const groupedWhole = Number(whole).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });

  return hasDecimal ? `${groupedWhole}.${decimalValue}` : groupedWhole;
}

export function InputWithLabel<T extends FieldValues = FieldValues>({
  fieldTitle,
  nameInSchema,
  register,
  type = "text",
  className,
  containerClassName,
  readOnly,
  format,
  ...props
}: Props<T> & { format?: "money" }) {

  const isMoney = format === "money";
  void register;

  return (
    <FormField
      name={nameInSchema as Path<T>}
      render={({ field }) => {

        return (
          <FormItem className={cn("space-y-1.5", containerClassName)}>
            <FormLabel>{fieldTitle}</FormLabel>

            <FormControl>
            <Input
            {...props}
            {...field}
            type={isMoney ? "text" : type}
            inputMode={isMoney ? "decimal" : props.inputMode}
            readOnly={readOnly}
            className={cn("w-full min-w-0", className)}

            value={
              isMoney
                ? field.value === "" || field.value == null
                  ? "0"
                  : field.value
                : field.value ?? ""
            }

            onChange={(e) => {
              if (!isMoney) {
                field.onChange(e.target.value);
                return;
              }

              let raw = e.target.value.replace(/,/g, "");

              // Allow user to temporarily clear while typing
              if (raw === "") {
                field.onChange("0");
                return;
              }

              // Allow ".", "12.", "12.3"
              if (!/^\d*\.?\d*$/.test(raw)) return;

              // Replace leading zero when typing a number
              if (raw.length > 1 && raw.startsWith("0") && !raw.startsWith("0.")) {
                raw = raw.replace(/^0+/, "");
              }

              field.onChange(raw);
            }}

            onBlur={() => {
              if (!isMoney) return;

              const v = field.value;

              if (!v || v === "") {
                field.onChange("0");
                return;
              }

              field.onChange(formatMoney(v));
            }}
          />
            </FormControl>

            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}





// "use client";

// import { UseFormRegister, Path } from "react-hook-form";
// import {
//   FormControl,
//   FormField,
//   FormItem,
//   FormLabel,
//   FormMessage,
// } from "@/components/ui/form";
// import { Input } from "@/components/ui/input";
// import { InputHTMLAttributes, forwardRef } from "react";

// type Props<S> = {
//   fieldTitle: string;
//   nameInSchema: keyof S & string;
//   register?: UseFormRegister<any>;
//   type?: string;
//   className?: string;
//   value?: string;
//   onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
//   readOnly?: boolean;
// } & InputHTMLAttributes<HTMLInputElement>;

// export function InputWithLabel<S>({
//   fieldTitle,
//   nameInSchema,
//   register,
//   type = "text",
//   className,
//   value,
//   onChange,
//   readOnly,
//   ...props
// }: Props<S>) {
//   const inputProps = register
//     ? {
//         ...register(nameInSchema, {
//           ...(type === "number"
//             ? {
//                 setValueAs: (v) => (v === "" || v === null || v === undefined ? 0 : Number(v)),
//               }
//             : {}),
//         }),
//       }
//     : {
//         value,
//         onChange,
//       };

//   return (
//     <FormField
//       name={nameInSchema}
//       render={() => (
//         <FormItem>
//           <FormLabel className="text-base" htmlFor={nameInSchema}>
//             {fieldTitle}
//           </FormLabel>
//           <FormControl>
//             <Input
//               type={type}
//               id={nameInSchema}
//               name={nameInSchema}
//               value={value}
//               className={`w-full max-w-xs disabled:text-blue-500 dark:disabled:text-green-500 disabled:opacity-75 ${className}`}
//               readOnly={readOnly}
//               {...props}
//               {...inputProps}
//             />
//           </FormControl>
//           <FormMessage />
//         </FormItem>
//       )}
//     />
//   );
// }


// "use client";

// import { UseFormRegister, FieldValues, FieldPath } from "react-hook-form";
// import {
//   FormControl,
//   FormField,
//   FormItem,
//   FormLabel,
//   FormMessage,
// } from "@/components/ui/form";
// import { Input } from "@/components/ui/input";
// import { InputHTMLAttributes } from "react";

// type Props<T extends FieldValues> = {
//   fieldTitle: string;
//   nameInSchema: FieldPath<T>;
//   register?: UseFormRegister<T>;
//   type?: string;
//   className?: string;
//   readOnly?: boolean;
// } & InputHTMLAttributes<HTMLInputElement>;

// export function InputWithLabel<T extends FieldValues>({
//   fieldTitle,
//   nameInSchema,
//   register,
//   type = "text",
//   className,
//   readOnly,
//   ...props
// }: Props<T>) {
//   const inputProps = register
//     ? register(nameInSchema, {
//         ...(type === "number"
//           ? {
//               setValueAs: (v) =>
//                 v === "" || v === null || v === undefined ? null : Number(v),
//             }
//           : {}),
//       })
//     : {};

//   return (
//     <FormField
//       name={nameInSchema}
//       render={() => (
//         <FormItem>
//           <FormLabel htmlFor={nameInSchema}>{fieldTitle}</FormLabel>
//           <FormControl>
//             <Input
//               id={nameInSchema}
//               type={type}
//               readOnly={readOnly}
//               className={`w-full max-w-xs ${className}`}
//               {...inputProps}
//               {...props}
//             />
//           </FormControl>
//           <FormMessage />
//         </FormItem>
//       )}
//     />
//   );
// }
