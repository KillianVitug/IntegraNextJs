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

  // 👇 Accept BOTH typed paths AND plain strings (legacy-safe)
  nameInSchema: Path<T> | (string & {});

  register?: UseFormRegister<T>;

  type?: string;
  className?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  readOnly?: boolean;
} & InputHTMLAttributes<HTMLInputElement>;

export function InputWithLabel<T extends FieldValues = FieldValues>({
  fieldTitle,
  nameInSchema,
  register,
  type = "text",
  className,
  value,
  onChange,
  readOnly,
  ...props
}: Props<T>) {
  const inputProps = register
    ? {
        ...register(nameInSchema as Path<T>, {
          ...(type === "number"
            ? {
                setValueAs: (v) =>
                  v === "" || v === null || v === undefined
                    ? null
                    : Number(v),
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
      name={nameInSchema as Path<T>}
      render={() => (
        <FormItem>
          <FormLabel className="text-base" htmlFor={String(nameInSchema)}>
            {fieldTitle}
          </FormLabel>
          <FormControl>
            <Input
              {...props}
              {...inputProps}
              type={type}
              id={String(nameInSchema)}
              name={String(nameInSchema)}
              className={`w-full max-w-xs disabled:text-blue-500 dark:disabled:text-green-500 disabled:opacity-75 ${className}`}
              readOnly={readOnly}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
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
