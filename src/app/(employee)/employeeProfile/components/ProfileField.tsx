"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type FieldProps = {
  label: string;
  value?: string;
  className?: string;
  inputClassName?: string;
};

type TextAreaProps = {
  label: string;
  value?: string;
  className?: string;
};

export function ProfileField({
  label,
  value,
  className,
  inputClassName,
}: FieldProps) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label className="text-base">{label}</Label>
      <Input
        readOnly
        value={value ?? ""}
        className={`w-full max-w-xs ${inputClassName ?? ""}`}
      />
    </div>
  );
}

export function ProfileTextArea({ label, value, className }: TextAreaProps) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label className="text-base">{label}</Label>
      <Textarea readOnly value={value ?? ""} className="w-full" />
    </div>
  );
}
