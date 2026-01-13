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

type Props<T extends FieldValues = FieldValues> = {
  fieldTitle: string;
  nameInSchema: Path<T> | (string & {});
  register?: UseFormRegister<T>;
  type?: string;
  className?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  readOnly?: boolean;
} & InputHTMLAttributes<HTMLInputElement>;
import { stripCommas } from "@/lib/number"; 

export function formatMoney(v: string) {
  if (!v) return "0";
  const n = Number(stripCommas(v));
  if (isNaN(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function InputWithLabel<T extends FieldValues = FieldValues>({
  fieldTitle,
  nameInSchema,
  register,
  type = "text",
  className,
  readOnly,
  format,
  ...props
}: Props<T> & { format?: "money" }) {

  const isMoney = format === "money";

  return (
    <FormField
      name={nameInSchema as Path<T>}
      render={({ field }) => {

        return (
          <FormItem>
            <FormLabel>{fieldTitle}</FormLabel>

            <FormControl>
            <Input
              {...props}
              {...field}
              type="text"
              inputMode={isMoney ? "decimal" : undefined}
              readOnly={readOnly}
              className={`w-full max-w-xs ${className}`}

              value={
                isMoney
                  ? formatMoney(field.value ?? "0")
                  : field.value ?? ""   // 🔥 ALWAYS string
              }

              onChange={(e) => {
                if (!isMoney) {
                  field.onChange(e.target.value === "" ? "" : e.target.value);
                  return;
                }

                const raw = e.target.value.replace(/,/g, "");
                if (!/^\d*\.?\d*$/.test(raw)) return;
                field.onChange(raw === "" ? "0" : raw);
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
