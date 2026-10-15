import { NextRequest, NextResponse } from "next/server";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

// Previously opened pages contain two independently targeted forms. Never accept
// their hidden employee/type values after the new single-form workflow ships.
async function retireLegacyForm(request: NextRequest) {
  const form = await request.formData();
  const fields = ["employeeId", "leaveType", "dateFiled", "leaveStartDate", "leaveEndDate", "reason"];
  const retained = fields.map((field) => `${field}: ${String(form.get(field) ?? "").slice(0, 4000)}`).join("\n");
  return new NextResponse(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Leave form updated</title></head><body><main><h1>This leave form has been updated</h1><p>Your request was not submitted or changed. Copy your entries below, then open the current form and select the employee and leave type again.</p><label for="retained">Your entries</label><p><textarea id="retained" rows="14" cols="40" readonly>${escapeHtml(retained)}</textarea></p><p><a href="/managerLeaves">Open the current leave form</a></p></main></body></html>`, {
    status: 409,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "X-Content-Type-Options": "nosniff" },
  });
}

export async function saveLeaveRequestFromRequest(request: NextRequest) {
  return retireLegacyForm(request);
}

export async function cancelLeaveRequestFromRequest(request: NextRequest) {
  return retireLegacyForm(request);
}
