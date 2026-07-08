import { NextResponse } from "next/server";
import { getSalaryRateHistory } from "@/lib/queries/getSalaryRateHistory";

export async function GET(
  _req: Request,
  context: { params: Promise<{ employeeId: string }> }
) {
  try {
    const { employeeId } = await context.params; // ✅ await here

    if (!employeeId) {
      return NextResponse.json(
        { error: "Employee ID is required" },
        { status: 400 }
      );
    }

    const data = await getSalaryRateHistory(employeeId);

    return NextResponse.json({ data });
  } catch (error) {
    console.error("SalaryRateHistory API error:", error);

    return NextResponse.json(
      { error: "Failed to fetch salary rate history" },
      { status: 500 }
    );
  }
}
