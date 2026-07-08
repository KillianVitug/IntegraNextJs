import { NextRequest, NextResponse } from "next/server";
import { fetchStatutoryRuleVersions } from "@/lib/queries/fetchLookupData";

export async function GET(request: NextRequest) {
  const ruleType = request.nextUrl.searchParams.get("ruleType");
  const normalizedRuleType =
    ruleType === "SSS" ||
    ruleType === "PHILHEALTH" ||
    ruleType === "PAGIBIG" ||
    ruleType === "TAX"
      ? ruleType
      : undefined;

  const versions = await fetchStatutoryRuleVersions(normalizedRuleType);
  return NextResponse.json(versions, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
