export function stripCommas(v: string) {
    return v.replace(/,/g, "");
  }
  
  export function toNumber(v: unknown) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v;
    if (typeof v === "string") return Number(stripCommas(v));
    return null;
  }
  