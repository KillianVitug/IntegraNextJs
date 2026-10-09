import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";
import { z } from "zod";
import * as permissions from "@/lib/auth/permissions";

// Exercise the actual route modules without a database or production credentials.
// Session resolution and the salary query are boundary doubles; this is not an
// integration test of cookies, disabled-account invalidation or stored history.
type Actor = {
  employeeId: string;
  groupKeys: permissions.AuthGroupKey[];
  permissions: permissions.AuthPermission[];
};
type Route = {
  GET: (
    request: Request,
    context: { params: Promise<{ employeeId: string }> },
  ) => Promise<Response>;
};

const employeeA = "10000000-0000-4000-8000-000000000001";
const employeeB = "20000000-0000-4000-8000-000000000002";
const absentEmployee = "30000000-0000-4000-8000-000000000003";
let currentActor: Actor | null = null;
let queryFailure = false;
let authFailure = false;
let queriedEmployees: string[] = [];
let permissionChecks: string[] = [];
let authReads = 0;
let checks = 0;

const authBoundary = {
  async getCurrentAuthContext() {
    authReads += 1;
    if (authFailure) throw new Error("synthetic internal auth detail");
    return currentActor;
  },
  hasPermission(actor: Actor, permission: permissions.AuthPermission) {
    permissionChecks.push(permission);
    return actor.groupKeys.includes(permissions.AUTH_GROUP_KEYS.SYSTEM_ADMIN)
      || actor.permissions.includes(permission);
  },
};

function loadRoute(filename: string): Route {
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  });
  const exports: Partial<Route> = {};
  runInNewContext(compiled.outputText, {
    exports,
    console: { error() {} },
    require(specifier: string) {
      if (specifier === "next/server") return { NextResponse };
      if (specifier === "zod") return { z };
      if (specifier === "@/lib/auth/server") return authBoundary;
      if (specifier === "@/lib/auth/permissions") return permissions;
      if (specifier === "@/lib/queries/getSalaryRateHistory") {
        return {
          async getSalaryRateHistory(employeeId: string) {
            queriedEmployees.push(employeeId);
            if (queryFailure) throw new Error("synthetic internal payroll detail");
            return employeeId === absentEmployee ? [] : [{ employeeId, marker: "salary fixture" }];
          },
        };
      }
      if (specifier === "../SalaryRateHistory/route") {
        return loadRoute(path.resolve(path.dirname(filename), `${specifier}.ts`));
      }
      throw new Error(`Unexpected route dependency: ${specifier}`);
    },
  }, { filename });
  assert.equal(typeof exports.GET, "function");
  return exports as Route;
}

function actor(group: permissions.AuthGroupKey): Actor {
  return {
    employeeId: employeeA,
    groupKeys: [group],
    permissions: permissions.getPermissionsForGroups([group]),
  };
}

async function invoke(route: Route, employeeId: string, expectedStatus: number) {
  queriedEmployees = [];
  permissionChecks = [];
  authReads = 0;
  const response = await route.GET(
    new Request(`https://salary-access.invalid/employees/${employeeId}`),
    { params: Promise.resolve({ employeeId }) },
  );
  assert.equal(response.status, expectedStatus);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(authReads, 1);
  if (currentActor && !authFailure) {
    assert.deepEqual(permissionChecks, [permissions.AUTH_PERMISSIONS.SALARY_MANAGE]);
  }
  const body = await response.json();
  if (expectedStatus !== 200) assert.equal("data" in body, false);
  checks += 1;
  return body;
}

async function main() {
  const routeRoot = path.resolve("src/app/api/employees/[employeeId]");
  for (const routeName of ["SalaryRateHistory", "CustomPayrollHistory"]) {
    const route = loadRoute(path.join(routeRoot, routeName, "route.ts"));

    // Missing sessions and contexts rejected by the real auth layer (disabled,
    // expired or revoked) are represented by null; no salary query may run.
    currentActor = null;
    for (const target of [employeeA, employeeB, "invalid"]) {
      await invoke(route, target, 401);
      assert.deepEqual(queriedEmployees, []);
    }

    // A guessed target ID, own identity or department membership grants no
    // salary-history permission to Employee or Manager accounts.
    for (const group of [permissions.AUTH_GROUP_KEYS.EMPLOYEE, permissions.AUTH_GROUP_KEYS.MANAGER]) {
      currentActor = actor(group);
      for (const target of [employeeA, employeeB, "invalid"]) {
        await invoke(route, target, 403);
        assert.deepEqual(queriedEmployees, []);
      }
    }

    // Existing HR/System Admin authority is company-wide, including employees
    // outside the administrator's own identity or department.
    for (const group of [permissions.AUTH_GROUP_KEYS.HR_ADMIN, permissions.AUTH_GROUP_KEYS.SYSTEM_ADMIN]) {
      currentActor = actor(group);
      for (const target of [employeeA, employeeB]) {
        const body = await invoke(route, target, 200);
        assert.deepEqual(body, { data: [{ employeeId: target, marker: "salary fixture" }] });
        assert.deepEqual(queriedEmployees, [target]);
      }
      for (const target of ["", "invalid"]) {
        await invoke(route, target, 400);
        assert.deepEqual(queriedEmployees, []);
      }
    }

    assert.deepEqual(await invoke(route, absentEmployee, 200), { data: [] });
    assert.deepEqual(queriedEmployees, [absentEmployee]);

    queryFailure = true;
    const queryError = await invoke(route, employeeA, 500);
    assert.equal(JSON.stringify(queryError).includes("synthetic internal"), false);
    assert.deepEqual(queriedEmployees, [employeeA]);
    queryFailure = false;

    authFailure = true;
    const authError = await invoke(route, employeeA, 500);
    assert.equal(JSON.stringify(authError).includes("synthetic internal"), false);
    assert.deepEqual(queriedEmployees, []);
    authFailure = false;
  }
  console.log(JSON.stringify({ passed: true, checks, routes: 2, databaseAccess: false }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
