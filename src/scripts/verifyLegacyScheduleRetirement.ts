import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual exported handlers with imported boundaries replaced. Any DB,
// mutation helper, parser or cache call fails; this test never opens a database.
let role = "MANAGER";
let authCalls = 0;
const forbidden = new Proxy({}, { get(_target, name) { throw new Error(`Unexpected dependency use: ${String(name)}`); } });
class FixtureResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
  constructor(body: string, init: { status: number; headers: Record<string, string> }) { this.body = body; this.status = init.status; this.headers = init.headers; }
}
function load(file: string): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const source = readFileSync(path.join(process.cwd(), file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const require = (name: string) => {
    if (name === "next/server") return { NextResponse: FixtureResponse };
    if (name === "@/lib/auth/server") return {
      requireAuthenticatedUser: async () => { authCalls++; return { role, accountId: "fictional" }; },
      requireManager: async () => { authCalls++; if (role !== "MANAGER") throw new Error("Manager sign-in required."); return { accountId: "fictional" }; },
    };
    return forbidden;
  };
  new vm.Script(compiled, { filename: file }).runInNewContext({ exports, require });
  return exports;
}

async function main() {
  const handlers = load("src/app/(manager)/managerSchedules/form-handlers.ts");
  const request = { formData() { throw new Error("Retired routes must not parse submitted payloads."); } };
  for (const name of ["saveWeeklyScheduleFromRequest", "saveBulkWeeklyScheduleFromRequest", "savePayrollPeriodScheduleFromRequest", "deleteWeeklyScheduleFromRequest"]) {
    const before = authCalls;
    const response = await handlers[name](request) as FixtureResponse;
    assert.equal(response.status, 410);
    assert.match(response.body, /No schedule changes were saved/);
    assert.match(response.body, /href="\/schedules"/);
    assert.equal(authCalls, before + 1);
  }
  role = "EMPLOYEE";
  await assert.rejects(() => handlers.saveWeeklyScheduleFromRequest(request), /Manager sign-in required/);
  const actions = load("src/app/actions/shiftAssignmentAction.ts");
  for (const name of ["saveEmployeeWeeklyShiftPattern", "deleteEmployeeWeeklyShiftPattern"]) {
    for (const allowed of ["ADMIN", "MANAGER"]) { role = allowed; await assert.rejects(() => actions[name](forbidden), /Use Schedules \(\/schedules\)/); }
    role = "EMPLOYEE"; await assert.rejects(() => actions[name](forbidden), /Forbidden/);
  }
  for (const name of ["listEmployeeWeeklyShiftPatterns", "listEmployeeShiftAssignments", "saveEmployeeShiftAssignment", "deleteEmployeeShiftAssignment", "previewBulkDaySchedulesAction", "getBulkDayScheduleResultAction", "saveBulkDaySchedulesAction"]) assert.equal(typeof actions[name], "function");
  console.log("PASS retired scheduling mutations: four direct manager routes return410 with Schedules link; legacy weekly actions reject before parser/DB/helper calls; auth boundaries and active exports preserved");
}
void main();
