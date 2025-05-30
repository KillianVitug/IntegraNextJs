"use client";

import { Control, Controller } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type DataObj = {
    id: string;
    name: string;
};
type Props<S> = {
    fieldTitle: string;
    nameInSchema: keyof S & string;
    data: DataObj[];
    control?: Control<any>;
    value?: string;
    onChange?: (val: string) => void;
    className?: string;
  };
  
  export function SelectWithLabel<S>({
    fieldTitle,
    nameInSchema,
    data,
    control,
    value,
    onChange,
    className,
  }: Props<S>) {
    const isControlled = control && !value && !onChange;
  
    return (
      <FormField
        name={nameInSchema}
        control={control}
        render={() => (
          <FormItem>
            <FormLabel className="text-base mb-2" htmlFor={nameInSchema}>
              {fieldTitle}
            </FormLabel>
  
            {isControlled ? (
              <Controller
                name={nameInSchema}
                control={control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger id={nameInSchema} className={`w-full max-w-xs ${className}`}>
                        <SelectValue placeholder="Select">
                          {data.find((item) => String(item.id) === String(field.value))?.name || "Select"}
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {data.map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            ) : (
              <Select onValueChange={onChange} value={value}>
                <FormControl>
                  <SelectTrigger id={nameInSchema} className={`w-full max-w-xs ${className}`}>
                    <SelectValue placeholder="Select">
                      {data.find((item) => String(item.id) === String(value))?.name || "Select"}
                    </SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {data.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
  
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }
  