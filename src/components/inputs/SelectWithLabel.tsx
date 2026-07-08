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
import { cn } from "@/lib/utils";

const CLEAR_SELECTION_VALUE = "__clear_selection__";

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
  containerClassName?: string;
  isClearable?: boolean;
  disabled?: boolean;
};

export function SelectWithLabel<T extends FieldValues>({
  fieldTitle,
  nameInSchema,
  data,
  control,
  value,
  onChange,
  className,
  containerClassName,
  isClearable,
  disabled,
}: Props<T>) {
  const isControlled =
    Boolean(control) && value === undefined && onChange === undefined;

  const resolveValue = (rawValue: unknown) => {
    if (rawValue == null || rawValue === "") return "";

    const normalizedValue = String(rawValue);
    const hasMatchingOption = data.some(
      (item) => String(item.id) === normalizedValue
    );

    return hasMatchingOption ? normalizedValue : "";
  };

  const handleValueChange = (
    nextValue: string,
    change?: (val: string) => void
  ) => {
    const resolvedValue =
      isClearable && nextValue === CLEAR_SELECTION_VALUE ? "" : nextValue;

    change?.(resolvedValue);
  };

  if (isControlled) {
    // react-hook-form mode
    return (
      <FormField
        name={nameInSchema}
        control={control}
        render={() => (
          <FormItem className={cn("space-y-1.5", containerClassName)}>
            <FormLabel>{fieldTitle}</FormLabel>
            <Controller
              name={nameInSchema}
              control={control}
              render={({ field }) => (
                <Select
                  onValueChange={(nextValue) =>
                    handleValueChange(nextValue, field.onChange)
                  }
                  value={resolveValue(field.value)}
                  disabled={disabled}
                >
                  <FormControl>
                    <SelectTrigger
                      className={cn(
                        "w-full min-w-0 overflow-hidden [&>span]:min-w-0 [&>span]:truncate",
                        className
                      )}
                      disabled={disabled}
                    >
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {isClearable && (
                      <SelectItem value={CLEAR_SELECTION_VALUE}>None</SelectItem>
                    )}
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
    <div className={cn("space-y-1.5", containerClassName)}>
      <label className="block text-sm font-medium">{fieldTitle}</label>
      <Select
        onValueChange={(nextValue) => handleValueChange(nextValue, onChange)}
        value={resolveValue(value)}
        disabled={disabled}
      >
        <SelectTrigger
          className={cn(
            "w-full min-w-0 overflow-hidden [&>span]:min-w-0 [&>span]:truncate",
            className
          )}
          disabled={disabled}
        >
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent>
          {isClearable && (
            <SelectItem value={CLEAR_SELECTION_VALUE}>None</SelectItem>
          )}
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
