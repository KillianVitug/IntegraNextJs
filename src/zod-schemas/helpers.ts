import { z } from "zod";

export function requiredNumberField(label: string) {
  return z.preprocess(
    (value) => {
      if (value === "" || value == null) return undefined;
      return typeof value === "string" ? Number(value) : value;
    },
    z.number().finite(`${label} must be a number`)
  );
}

export function optionalNumberField() {
  return z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce.number().nullable()
  );
}

export function requiredDateField(label: string) {
  return z.string().min(1, `${label} is required`);
}

export const optionalDateField = z.preprocess(
  (value) => (value === "" || value == null ? null : value),
  z.string().nullable()
);

export const optionalTextField = z.preprocess(
  (value) => (value === "" || value == null ? null : value),
  z.string().nullable()
);
