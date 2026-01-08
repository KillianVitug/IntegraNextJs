"use client";
import { Control, Controller, FieldValues, Path } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DataObj = {
  id: string | number;
  name: string;
};

type Props<T extends FieldValues> = {
  fieldTitle: string;
  nameInSchema: Path<T>;
  data: DataObj[];
  control?: Control<T>;
  value?: string;
  onChange?: (val: string) => void;
  className?: string;
  isClearable?: boolean;
};

export function SelectWithLabel<T extends FieldValues>({
  fieldTitle,
  nameInSchema,
  data,
  control,
  value,
  onChange,
  className,
  isClearable,
}: Props<T>) {
  const isControlled = Boolean(control) && !value && !onChange;

  if (isControlled) {
    // react-hook-form mode
    return (
      <FormField
        name={nameInSchema}
        control={control}
        render={() => (
          <FormItem>
            <FormLabel>{fieldTitle}</FormLabel>
            <Controller
              name={nameInSchema}
              control={control}
              render={({ field }) => (
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? ""} // empty string for "no selection"
                >
                  <FormControl>
                    <SelectTrigger className={`w-full max-w-xs ${className}`}>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {isClearable && <SelectItem value="">None</SelectItem>}
                    {data.map((item) => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  // uncontrolled mode
  return (
    <div>
      <label className="text-base mb-2">{fieldTitle}</label>
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger className={`w-full max-w-xs ${className}`}>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent>
          {data.map((item) => (
            <SelectItem key={item.id} value={String(item.id)}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
