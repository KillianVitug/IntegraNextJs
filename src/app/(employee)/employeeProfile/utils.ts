import { formatMoney } from "@/components/inputs/InputWithLabel";

type Value = string | number | null | undefined;

export function displayValue(value: Value) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

export function formatMoneyValue(value: Value) {
  if (value === null || value === undefined || value === "") return "-";
  return formatMoney(String(value));
}

export function formatDateValue(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toISOString().slice(0, 10);
}

export function formatTimeValue(value: Value) {
  if (value === null || value === undefined || value === "") return "-";
  const str = String(value);
  if (str.includes(":")) return str.slice(0, 5);
  return str;
}
