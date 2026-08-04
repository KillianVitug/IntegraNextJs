export function stripCommas(v: string) {
    return v.replace(/,/g, "");
  }

  export function toNumber(v: unknown) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v;
    if (typeof v === "string") return Number(stripCommas(v));
    return null;
  }

type FormatRateDisplayOptions = {
  emptyValue?: string;
  zeroValue?: string;
  useGrouping?: boolean;
};

export function formatRateDisplay(
  value: string | number | null | undefined,
  options: FormatRateDisplayOptions = {}
) {
  const {
    emptyValue = "-",
    zeroValue = "0",
    useGrouping = true,
  } = options;

  if (value === null || value === undefined) return emptyValue;

  const raw = stripCommas(String(value)).trim();
  if (raw === "" || raw === "." || !/^\d*\.?\d*$/.test(raw)) {
    return emptyValue;
  }

  const numericValue = Number(raw);
  if (!Number.isFinite(numericValue)) return emptyValue;
  if (numericValue === 0) return zeroValue;

  const [wholeValue, decimalValue = ""] = raw.split(".");
  const whole = wholeValue === "" ? "0" : wholeValue;
  const formattedWhole = useGrouping
    ? Number(whole).toLocaleString("en-US", { maximumFractionDigits: 0 })
    : String(Number(whole));
  const trimmedDecimal = decimalValue.replace(/0+$/, "");

  return trimmedDecimal ? `${formattedWhole}.${trimmedDecimal}` : formattedWhole;
}
