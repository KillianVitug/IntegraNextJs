import {
  buildPayrollAccountCodeImportEmployeeLookup,
  combinePayrollAccountCodeImportRows,
  decodePayrollAccountCodeImportText,
  parsePayrollAccountCodeImportText,
  type ResolvedPayrollAccountCodeImportRow,
} from "@/lib/payroll/payrollAccountCodeImport";
import { normalizeAttendanceEmployeeKey } from "@/lib/payroll/attendance";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const sampleText = [
  "Payroll Period\tEmployee No\tAccount Code\tAmount\tNo. Of Hour(s)\tNo. Of Minute(s)",
  "2026-06-B\t00780\t9-051\t92\t\t",
  "2026-06-B\tEMP00083\tOT-REG\t\t1\t30",
  "2026-06-A\t00780\t9-051\t12\t\t",
  "2026-06-B\t00083\tOT-REG\t\t0\t45",
  "2026-06-B\t00999\tMISSING\t\t\t",
].join("\n");

const encoded = Buffer.from(sampleText, "utf8").toString("base64");
const decoded = decodePayrollAccountCodeImportText(encoded);
const parsed = parsePayrollAccountCodeImportText(decoded);

assert(parsed.totalRows === 5, "Expected five data rows.");
assert(parsed.rows.length === 4, "Expected four rows with values.");
assert(parsed.skippedRows.length === 1, "Expected one invalid row.");
assert(
  parsed.skippedRows[0]?.reason.includes("At least one value column"),
  "Expected missing value diagnostic."
);
assert(
  parsed.rows.filter((row) => row.payrollPeriodCode === "2026-06-B").length === 3,
  "Expected three selected-period candidate rows."
);
assert(
  normalizeAttendanceEmployeeKey("EMP00083") ===
    normalizeAttendanceEmployeeKey("00083"),
  "Expected employee keys with prefixes/leading zeroes to match."
);

const employeeAdminDuplicateLookup = buildPayrollAccountCodeImportEmployeeLookup([
  { id: "employee-83", employeeNo: "00083", employeeType: "EMP" },
  { id: "admin-83", employeeNo: "00083", employeeType: "ADMIN" },
]);
assert(
  employeeAdminDuplicateLookup.employeeByNormalizedKey.get("83")?.id ===
    "employee-83",
  "Expected account-code import lookup to ignore ADMIN duplicates."
);
assert(
  !employeeAdminDuplicateLookup.ambiguousEmployeeKeys.has("83"),
  "Expected ADMIN duplicate not to mark an employee number ambiguous."
);

const adminOnlyLookup = buildPayrollAccountCodeImportEmployeeLookup([
  { id: "admin-99", employeeNo: "00099", employeeType: "ADMIN" },
]);
assert(
  !adminOnlyLookup.employeeByNormalizedKey.has("99"),
  "Expected ADMIN-only employee number not to resolve for import."
);

const duplicateEmployeeLookup = buildPayrollAccountCodeImportEmployeeLookup([
  { id: "employee-83-a", employeeNo: "00083", employeeType: "EMP" },
  { id: "employee-83-b", employeeNo: "EMP00083", employeeType: "EMP" },
]);
assert(
  duplicateEmployeeLookup.ambiguousEmployeeKeys.has("83") &&
    !duplicateEmployeeLookup.employeeByNormalizedKey.has("83"),
  "Expected duplicate EMP records to remain ambiguous."
);

const resolvedRows: ResolvedPayrollAccountCodeImportRow[] = parsed.rows
  .filter((row) => row.payrollPeriodCode === "2026-06-B")
  .map((row) => ({
    ...row,
    employeeId:
      normalizeAttendanceEmployeeKey(row.employeeNo) === "83"
        ? "employee-83"
        : "employee-780",
    accountCodeId: row.accountCode === "OT-REG" ? 2 : 1,
    accountCode: row.accountCode,
    accountType: row.accountCode === "OT-REG" ? "Overtime" : "Other Income",
    accountDescription: row.accountCode,
    accountMonth13thPay: false,
    accountNonTaxable: false,
  }));
const combinedRows = combinePayrollAccountCodeImportRows(resolvedRows);
const combinedOvertime = combinedRows.find(
  (row) => row.employeeId === "employee-83" && row.accountCode === "OT-REG"
);

assert(combinedRows.length === 2, "Expected duplicate rows to combine.");
assert(
  combinedOvertime?.quantityMinutes === 135,
  "Expected duplicate hour/minute rows to sum to 135 minutes."
);

console.log("Payroll account-code import verification passed.");
