// Unit-test bootstrap only. The payroll engine imports audit helpers through the
// authenticated admin module; no session/redirect is exercised by these DB tests.
// Next's real navigation entrypoint needs its bundler and cannot run under the
// raw React server condition. An unexpected auth redirect must fail this test.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module");
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "next/navigation") return {
    redirect() { throw new Error("Unexpected authentication redirect in payroll storage test"); },
  };
  return load.call(this, request, parent, isMain);
};
