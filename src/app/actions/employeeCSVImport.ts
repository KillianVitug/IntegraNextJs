import { parse } from "csv-parse/sync";
import { and, eq, inArray } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import {
  bankCodeTypeEnum,
  categoryEnum,
  civilStatusEnum,
  confidentialityLevelEnum,
  department,
  employees,
  employeesGeneralInfo,
  employeesOtherReferences,
  employeesSalary,
  employeesTimekeeping,
  employmentStatusEnum,
  genderEnum,
  payrollModeEnum,
  position,
  restDayEnum,
  shiftScheduleEnum,
  taxStatusEnum,
} from "@/db/schema";
import { syncLinkedAccountEmailTx } from "@/lib/auth/server";
import { DEFAULT_EMPLOYEE_TYPE } from "@/utils/employeeCode";
import { InvalidEmployeeNoError, normalizeEmployeeNoForSave } from "@/utils/employeeNo";

type RawCsvRow = Record<string, unknown>;

type CanonicalField =
  | "employeeNo"
  | "firstName"
  | "lastName"
  | "middleName"
  | "middleInitial"
  | "suffix"
  | "dateHired"
  | "separationDate"
  | "clearanceDate"
  | "departmentName"
  | "departmentCode"
  | "payrollMode"
  | "payrollTerms"
  | "category"
  | "employmentStatus"
  | "confidentialityLevel"
  | "taxStatus"
  | "sssNumber"
  | "philhealthNumber"
  | "taxIdNumber"
  | "pagIbigNumber"
  | "perraIdNumber"
  | "monthlyRate"
  | "dailyRate"
  | "monthlyAllowance"
  | "dailyAllowance"
  | "cola"
  | "rateDivisor"
  | "billingRate"
  | "positionName"
  | "address"
  | "email"
  | "telephoneNo"
  | "bankCode"
  | "bankAccountNo"
  | "birthday"
  | "civilStatus"
  | "gender"
  | "timekeepingId"
  | "shiftSchedule"
  | "checkInTime"
  | "checkOutTime"
  | "restDay"
  | "hoursWorked"
  | "minutesWorked";

type NormalizedCsvRow = Partial<Record<CanonicalField, string>> & {
  rowNumber: number;
};

type ImportRow = {
  rowNumber: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
} & Partial<Record<CanonicalField, string | number>>;

type LookupMaps = {
  departmentByName: Map<string, { id: number; name: string; code: string }>;
  departmentByCode: Map<string, { id: number; name: string; code: string }>;
  positionByName: Map<string, { id: number; name: string }>;
};

type EmployeeOwnedTable =
  | typeof employeesGeneralInfo
  | typeof employeesSalary
  | typeof employeesOtherReferences
  | typeof employeesTimekeeping;

export type EmployeeCsvImportSummary = {
  totalRows: number;
  createdEmployees: number;
  updatedEmployees: number;
  createdDepartments: number;
  createdPositions: number;
};

export type EmployeeCsvImportResult = {
  success: true;
  summary: EmployeeCsvImportSummary;
  createdEmployees: number;
  updatedEmployees: number;
  createdDepartments: number;
  createdPositions: number;
  errors: string[];
};

export class EmployeeCsvImportError extends Error {
  errors: string[];

  constructor(errors: string[]) {
    super("CSV import validation failed.");
    this.name = "EmployeeCsvImportError";
    this.errors = errors;
  }
}

const DEPARTMENT_CODE_MAX_LENGTH = 50;
const IMPORT_PAYROLL_TERMS = "Semi-Monthly";

const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  employeeNo: ["EmployeeNo", "Employee No", "Employee No.", "Emp No"],
  firstName: ["firstName", "First Name"],
  lastName: ["lastName", "Last Name"],
  middleName: ["middleName", "Middle Name"],
  middleInitial: ["middleInitial", "Middle Initial"],
  suffix: ["suffix"],
  dateHired: ["dateHired", "Date Hired"],
  separationDate: ["Separation Date"],
  clearanceDate: ["Clearance Date"],
  departmentName: ["Department", "DEPARTMENT"],
  departmentCode: ["Department Code", "Dept Code"],
  payrollMode: ["Payroll Mode"],
  payrollTerms: ["Payroll Terms"],
  category: ["Category"],
  employmentStatus: ["Employment Status", "Status"],
  confidentialityLevel: ["Confidentiality Level"],
  taxStatus: ["Tax Status"],
  sssNumber: ["SSS", "SSS No", "SSS No."],
  philhealthNumber: ["PhilHealth", "philHealth", "Phil-Health", "Phil-Health No."],
  taxIdNumber: ["Tax ID", "Tax ID No.", "TIN", "taxId"],
  pagIbigNumber: ["PagIbig", "Pag-Ibig", "Pag-Ibig No.", "pagIbig"],
  perraIdNumber: ["PERAA", "PERRA", "PERRA ID", "PERRA ID No."],
  monthlyRate: ["Monthly", "Monthly Rate"],
  dailyRate: ["Daily", "Daily Rate"],
  monthlyAllowance: ["Monthly Allowance"],
  dailyAllowance: ["Daily Allowance"],
  cola: ["COLA"],
  rateDivisor: ["Rate Divisor"],
  billingRate: ["Billing Rate"],
  positionName: ["Position"],
  address: ["Address", "address"],
  email: ["Email"],
  telephoneNo: ["Telephone", "Phone", "telephone"],
  bankCode: ["Bank Code"],
  bankAccountNo: ["Bank Account", "bankAccount", "Bank Account No."],
  birthday: ["Birthday"],
  civilStatus: ["Civil Status"],
  gender: ["Gender"],
  timekeepingId: ["Timekeeping ID", "Timekeeping ID No."],
  shiftSchedule: ["Shift Schedule", "Shift/Schedule"],
  checkInTime: ["Check In", "Check-In Time"],
  checkOutTime: ["Check Out", "Check-Out Time"],
  restDay: ["Rest Day"],
  hoursWorked: ["Hours", "Total Hours"],
  minutesWorked: ["Minutes", "Total Minutes"],
};

const FIELD_LENGTHS: Partial<Record<CanonicalField, number>> = {
  employeeNo: 50,
  firstName: 50,
  lastName: 50,
  middleName: 50,
  middleInitial: 50,
  suffix: 20,
  departmentName: 50,
  departmentCode: 50,
  sssNumber: 20,
  philhealthNumber: 20,
  taxIdNumber: 20,
  pagIbigNumber: 20,
  perraIdNumber: 20,
  positionName: 50,
  email: 255,
  telephoneNo: 20,
  bankAccountNo: 50,
  timekeepingId: 50,
};

const DATE_FIELDS = [
  "dateHired",
  "separationDate",
  "clearanceDate",
  "birthday",
] as const satisfies CanonicalField[];

const MONEY_FIELDS = [
  "monthlyRate",
  "dailyRate",
  "monthlyAllowance",
  "dailyAllowance",
  "cola",
  "rateDivisor",
  "billingRate",
] as const satisfies CanonicalField[];

const NUMBER_FIELDS = ["hoursWorked", "minutesWorked"] as const satisfies CanonicalField[];

const ALIAS_TO_FIELD = buildAliasMap();

export function parseCsv(buffer: Buffer): RawCsvRow[] {
  return parse(buffer, {
    bom: true,
    columns: (headers: string[]) =>
      headers.map((header) => String(header ?? "").replace(/^\uFEFF/, "").trim()),
    skip_empty_lines: true,
    trim: true,
  });
}

export async function importEmployeesFromCsv(
  rows: RawCsvRow[],
): Promise<EmployeeCsvImportResult> {
  const importRows = normalizeAndValidateRows(rows);

  const summary: EmployeeCsvImportSummary = {
    totalRows: importRows.length,
    createdEmployees: 0,
    updatedEmployees: 0,
    createdDepartments: 0,
    createdPositions: 0,
  };

  await db.transaction(async (tx) => {
    const lookups = await buildLookupMaps(tx);
    const employeeNos = importRows.map((row) => row.employeeNo);
    const existingEmployees = await tx
      .select({
        id: employees.id,
        employeeNo: employees.employeeNo,
      })
      .from(employees)
      .where(
        and(
          inArray(employees.employeeNo, employeeNos),
          eq(employees.employeeType, DEFAULT_EMPLOYEE_TYPE),
        ),
      );
    const employeeByNo = new Map(
      existingEmployees.map((employee) => [employee.employeeNo, employee]),
    );

    for (const row of importRows) {
      const existingEmployee = employeeByNo.get(row.employeeNo);
      const employeeId = existingEmployee
        ? existingEmployee.id
        : await createEmployee(tx, row);

      if (existingEmployee) {
        await updateEmployee(tx, employeeId, row);
        summary.updatedEmployees += 1;
      } else {
        employeeByNo.set(row.employeeNo, {
          id: employeeId,
          employeeNo: row.employeeNo,
        });
        summary.createdEmployees += 1;
      }

      const departmentId = await resolveDepartmentId(tx, row, lookups, summary);
      const positionId = await resolvePositionId(tx, row, lookups, summary);

      await upsertEmployeeOwnedRow(tx, employeesGeneralInfo, employeeId, {
        ...pickDefined(row, [
          "dateHired",
          "separationDate",
          "payrollMode",
          "category",
          "employmentStatus",
          "confidentialityLevel",
          "clearanceDate",
          "taxStatus",
          "sssNumber",
          "philhealthNumber",
          "taxIdNumber",
          "pagIbigNumber",
          "perraIdNumber",
        ]),
        payrollTerms: IMPORT_PAYROLL_TERMS,
        ...(departmentId !== undefined ? { departmentId } : {}),
      });

      await upsertEmployeeOwnedRow(
        tx,
        employeesSalary,
        employeeId,
        withNewEmployeeDefaults(
          !existingEmployee,
          {
            dailyRate: "0.00",
            monthlyRate: "0.00",
            monthlyAllowance: "0.00",
            dailyAllowance: "0.00",
            cola: "0.00",
            rateDivisor: "0.00",
            billingRate: "0.00",
          },
          pickDefined(row, [
            "dailyRate",
            "monthlyRate",
            "monthlyAllowance",
            "dailyAllowance",
            "cola",
            "rateDivisor",
            "billingRate",
          ]),
        ),
      );

      const referenceData = {
        ...pickDefined(row, [
          "bankCode",
          "bankAccountNo",
          "address",
          "email",
          "telephoneNo",
          "birthday",
          "civilStatus",
          "gender",
        ]),
        ...(positionId !== undefined ? { positionId } : {}),
        ...(typeof row.birthday === "string"
          ? { age: calculateAge(row.birthday) }
          : {}),
      };

      await upsertEmployeeOwnedRow(
        tx,
        employeesOtherReferences,
        employeeId,
        withNewEmployeeDefaults(
          !existingEmployee,
          { bankCode: "Philippine National Bank - (PNB)" },
          referenceData,
        ),
      );

      if (typeof row.email === "string") {
        await syncLinkedAccountEmailTx(tx, employeeId, row.email);
      }

      await upsertEmployeeOwnedRow(
        tx,
        employeesTimekeeping,
        employeeId,
        withNewEmployeeDefaults(
          !existingEmployee,
          { hoursWorked: "0", minutesWorked: "0" },
          pickDefined(row, [
            "timekeepingId",
            "shiftSchedule",
            "checkInTime",
            "checkOutTime",
            "restDay",
            "hoursWorked",
            "minutesWorked",
          ]),
        ),
      );
    }
  });

  return {
    success: true,
    summary,
    createdEmployees: summary.createdEmployees,
    updatedEmployees: summary.updatedEmployees,
    createdDepartments: summary.createdDepartments,
    createdPositions: summary.createdPositions,
    errors: [],
  };
}

function buildAliasMap() {
  const aliasMap = new Map<string, CanonicalField>();

  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [
    CanonicalField,
    string[],
  ][]) {
    for (const alias of aliases) {
      aliasMap.set(normalizeHeader(alias), field);
    }
  }

  return aliasMap;
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeCell(value: unknown) {
  if (value == null) return "";
  return String(value).replace(/^\uFEFF/, "").trim();
}

function normalizeRawRow(row: RawCsvRow, rowNumber: number): NormalizedCsvRow {
  const normalized: NormalizedCsvRow = { rowNumber };

  for (const [rawHeader, rawValue] of Object.entries(row)) {
    const field = ALIAS_TO_FIELD.get(normalizeHeader(rawHeader));
    if (!field) continue;

    const value = normalizeCell(rawValue);
    if (value === "") continue;

    normalized[field] = value;
  }

  return normalized;
}

function normalizeAndValidateRows(rows: RawCsvRow[]) {
  const errors: string[] = [];

  if (!rows.length) {
    throw new EmployeeCsvImportError(["CSV has no employee rows."]);
  }

  const seenEmployeeNos = new Map<string, number>();
  const normalizedRows = rows.map((row, index) => normalizeRawRow(row, index + 2));

  for (const row of normalizedRows) {
    for (const field of ["employeeNo", "firstName", "lastName"] as const) {
      if (!row[field]) {
        errors.push(`Row ${row.rowNumber}: ${field} is required.`);
      }
    }

    if (row.employeeNo) {
      try {
        row.employeeNo = normalizeEmployeeNoForSave(row.employeeNo, {
          allowLegacyPrefix: true,
        });
      } catch (error) {
        errors.push(
          `Row ${row.rowNumber}: ${
            error instanceof InvalidEmployeeNoError
              ? error.message
              : "Employee No is invalid."
          }`,
        );
        continue;
      }

      const employeeNoKey = row.employeeNo.toLowerCase();
      const duplicateRow = seenEmployeeNos.get(employeeNoKey);

      if (duplicateRow) {
        errors.push(
          `Row ${row.rowNumber}: Employee No. "${row.employeeNo}" is duplicated; first seen on row ${duplicateRow}.`,
        );
      } else {
        seenEmployeeNos.set(employeeNoKey, row.rowNumber);
      }
    }

    validateLengths(row, errors);
  }

  if (errors.length) {
    throw new EmployeeCsvImportError(errors);
  }

  const importRows = normalizedRows.map((row) => {
    const parsedRow: ImportRow = {
      rowNumber: row.rowNumber,
      employeeNo: row.employeeNo!,
      firstName: row.firstName!,
      lastName: row.lastName!,
    };

    assignTextFields(parsedRow, row, [
      "middleName",
      "middleInitial",
      "suffix",
      "departmentName",
      "departmentCode",
      "sssNumber",
      "philhealthNumber",
      "taxIdNumber",
      "pagIbigNumber",
      "perraIdNumber",
      "positionName",
      "address",
      "email",
      "telephoneNo",
      "bankAccountNo",
      "timekeepingId",
    ]);

    for (const field of DATE_FIELDS) {
      const parsedDate = parseDateField(row[field], row.rowNumber, field, errors);
      if (parsedDate) parsedRow[field] = parsedDate;
    }

    for (const field of MONEY_FIELDS) {
      const parsedMoney = parseMoneyField(row[field], row.rowNumber, field, errors);
      if (parsedMoney) parsedRow[field] = parsedMoney;
    }

    for (const field of NUMBER_FIELDS) {
      const parsedNumber = parseNumberField(row[field], row.rowNumber, field, errors);
      if (parsedNumber !== undefined) parsedRow[field] = parsedNumber;
    }

    const checkInTime = parseTimeField(row.checkInTime, row.rowNumber, "checkInTime", errors);
    const checkOutTime = parseTimeField(row.checkOutTime, row.rowNumber, "checkOutTime", errors);

    if (checkInTime) parsedRow.checkInTime = checkInTime;
    if (checkOutTime) parsedRow.checkOutTime = checkOutTime;

    assignEnumField(parsedRow, row, "payrollMode", payrollModeEnum.enumValues, errors);
    assignEnumField(parsedRow, row, "category", categoryEnum.enumValues, errors);
    assignEnumField(
      parsedRow,
      row,
      "employmentStatus",
      employmentStatusEnum.enumValues,
      errors,
    );
    assignEnumField(
      parsedRow,
      row,
      "confidentialityLevel",
      confidentialityLevelEnum.enumValues,
      errors,
    );
    assignEnumField(parsedRow, row, "taxStatus", taxStatusEnum.enumValues, errors);
    assignEnumField(parsedRow, row, "bankCode", bankCodeTypeEnum.enumValues, errors);
    assignEnumField(parsedRow, row, "civilStatus", civilStatusEnum.enumValues, errors);
    assignEnumField(parsedRow, row, "gender", genderEnum.enumValues, errors);
    assignEnumField(parsedRow, row, "shiftSchedule", shiftScheduleEnum.enumValues, errors);
    assignEnumField(parsedRow, row, "restDay", restDayEnum.enumValues, errors);

    return parsedRow;
  });

  if (errors.length) {
    throw new EmployeeCsvImportError(errors);
  }

  return importRows;
}

function validateLengths(row: NormalizedCsvRow, errors: string[]) {
  for (const [field, maxLength] of Object.entries(FIELD_LENGTHS) as [
    CanonicalField,
    number,
  ][]) {
    const value = row[field];
    if (typeof value === "string" && value.length > maxLength) {
      errors.push(
        `Row ${row.rowNumber}: ${field} must be ${maxLength} characters or fewer.`,
      );
    }
  }
}

function assignTextFields(
  target: ImportRow,
  row: NormalizedCsvRow,
  fields: CanonicalField[],
) {
  for (const field of fields) {
    const value = row[field];
    if (value) target[field] = field === "email" ? value.toLowerCase() : value;
  }
}

function assignEnumField(
  target: ImportRow,
  row: NormalizedCsvRow,
  field: CanonicalField,
  values: readonly string[],
  errors: string[],
) {
  const value = row[field];
  if (!value) return;

  const match = values.find((option) => option.toLowerCase() === value.toLowerCase());
  if (!match) {
    errors.push(
      `Row ${row.rowNumber}: ${field} "${value}" is invalid. Allowed values: ${values.join(", ")}.`,
    );
    return;
  }

  target[field] = match;
}

function parseDateField(
  value: string | undefined,
  rowNumber: number,
  field: CanonicalField,
  errors: string[],
) {
  if (!value) return undefined;

  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return toDateString(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
      rowNumber,
      field,
      errors,
    );
  }

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const year = normalizeYear(Number(slashMatch[3]));
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;

    return toDateString(year, month, day, rowNumber, field, errors);
  }

  const parsedDate = new Date(value);
  if (!Number.isNaN(parsedDate.getTime())) {
    return toDateString(
      parsedDate.getFullYear(),
      parsedDate.getMonth() + 1,
      parsedDate.getDate(),
      rowNumber,
      field,
      errors,
    );
  }

  errors.push(`Row ${rowNumber}: ${field} "${value}" is not a valid date.`);
  return undefined;
}

function normalizeYear(year: number) {
  if (year >= 100) return year;
  return year >= 50 ? 1900 + year : 2000 + year;
}

function toDateString(
  year: number,
  month: number,
  day: number,
  rowNumber: number,
  field: CanonicalField,
  errors: string[],
) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const isValid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!isValid) {
    errors.push(`Row ${rowNumber}: ${field} is not a valid date.`);
    return undefined;
  }

  return date.toISOString().slice(0, 10);
}

function parseMoneyField(
  value: string | undefined,
  rowNumber: number,
  field: CanonicalField,
  errors: string[],
) {
  if (!value) return undefined;

  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    errors.push(`Row ${rowNumber}: ${field} "${value}" must be a non-negative number.`);
    return undefined;
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue)) {
    errors.push(`Row ${rowNumber}: ${field} "${value}" must be a valid number.`);
    return undefined;
  }

  return numericValue.toFixed(2);
}

function parseNumberField(
  value: string | undefined,
  rowNumber: number,
  field: CanonicalField,
  errors: string[],
) {
  if (!value) return undefined;

  const normalized = value.replace(/,/g, "").trim();
  const numericValue = Number(normalized);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    errors.push(`Row ${rowNumber}: ${field} "${value}" must be a non-negative number.`);
    return undefined;
  }

  return numericValue.toString();
}

function parseTimeField(
  value: string | undefined,
  rowNumber: number,
  field: CanonicalField,
  errors: string[],
) {
  if (!value) return undefined;

  const twelveHour = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (twelveHour) {
    let hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2]);
    const second = Number(twelveHour[3] ?? "0");
    const period = twelveHour[4].toUpperCase();

    if (hour < 1 || hour > 12 || minute > 59 || second > 59) {
      errors.push(`Row ${rowNumber}: ${field} "${value}" is not a valid time.`);
      return undefined;
    }

    if (period === "PM" && hour < 12) hour += 12;
    if (period === "AM" && hour === 12) hour = 0;

    return formatTime(hour, minute, second);
  }

  const twentyFourHour = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2]);
    const second = Number(twentyFourHour[3] ?? "0");

    if (hour > 23 || minute > 59 || second > 59) {
      errors.push(`Row ${rowNumber}: ${field} "${value}" is not a valid time.`);
      return undefined;
    }

    return formatTime(hour, minute, second);
  }

  errors.push(`Row ${rowNumber}: ${field} "${value}" is not a valid time.`);
  return undefined;
}

function formatTime(hour: number, minute: number, second: number) {
  return [hour, minute, second]
    .map((part) => part.toString().padStart(2, "0"))
    .join(":");
}

async function buildLookupMaps(tx: DbClient): Promise<LookupMaps> {
  const [departments, positions] = await Promise.all([
    tx.select().from(department),
    tx.select().from(position),
  ]);

  return {
    departmentByName: new Map(
      departments.map((row: typeof department.$inferSelect) => [
        row.name.toLowerCase(),
        { id: row.id, name: row.name, code: row.code },
      ]),
    ),
    departmentByCode: new Map(
      departments.map((row: typeof department.$inferSelect) => [
        row.code.toLowerCase(),
        { id: row.id, name: row.name, code: row.code },
      ]),
    ),
    positionByName: new Map(
      positions.map((row: typeof position.$inferSelect) => [
        row.name.toLowerCase(),
        { id: row.id, name: row.name },
      ]),
    ),
  };
}

async function resolveDepartmentId(
  tx: DbClient,
  row: ImportRow,
  lookups: LookupMaps,
  summary: EmployeeCsvImportSummary,
) {
  const departmentName =
    typeof row.departmentName === "string" ? row.departmentName.trim() : "";
  const departmentCode =
    typeof row.departmentCode === "string" ? row.departmentCode.trim() : "";

  if (!departmentName && !departmentCode) return undefined;

  const byName = departmentName
    ? lookups.departmentByName.get(departmentName.toLowerCase())
    : undefined;
  if (byName) return byName.id;

  const byCode = departmentCode
    ? lookups.departmentByCode.get(departmentCode.toLowerCase())
    : undefined;
  if (byCode) return byCode.id;

  const name = departmentName || departmentCode;
  const code = createUniqueDepartmentCode(departmentCode || name, lookups);
  const [created] = await tx
    .insert(department)
    .values({ name, code })
    .returning({ id: department.id, name: department.name, code: department.code });

  lookups.departmentByName.set(created.name.toLowerCase(), created);
  lookups.departmentByCode.set(created.code.toLowerCase(), created);
  summary.createdDepartments += 1;

  return created.id;
}

async function resolvePositionId(
  tx: DbClient,
  row: ImportRow,
  lookups: LookupMaps,
  summary: EmployeeCsvImportSummary,
) {
  const positionName = typeof row.positionName === "string" ? row.positionName.trim() : "";
  if (!positionName) return undefined;

  const existing = lookups.positionByName.get(positionName.toLowerCase());
  if (existing) return existing.id;

  const [created] = await tx
    .insert(position)
    .values({ name: positionName })
    .returning({ id: position.id, name: position.name });

  lookups.positionByName.set(created.name.toLowerCase(), created);
  summary.createdPositions += 1;

  return created.id;
}

function createUniqueDepartmentCode(value: string, lookups: LookupMaps) {
  const normalized =
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "")
      .slice(0, DEPARTMENT_CODE_MAX_LENGTH) || "DEPT";

  let code = normalized;
  let suffix = 2;

  while (lookups.departmentByCode.has(code.toLowerCase())) {
    const suffixText = suffix.toString();
    code =
      normalized.slice(0, DEPARTMENT_CODE_MAX_LENGTH - suffixText.length) +
      suffixText;
    suffix += 1;
  }

  return code;
}

async function createEmployee(tx: DbClient, row: ImportRow) {
  const [created] = await tx
    .insert(employees)
    .values({
      employeeType: DEFAULT_EMPLOYEE_TYPE,
      employeeNo: row.employeeNo,
      firstName: row.firstName,
      lastName: row.lastName,
      middleName: typeof row.middleName === "string" ? row.middleName : null,
      middleInitial:
        typeof row.middleInitial === "string" ? row.middleInitial : null,
      suffix: typeof row.suffix === "string" ? row.suffix : null,
    })
    .returning({ id: employees.id });

  return created.id;
}

async function updateEmployee(tx: DbClient, employeeId: string, row: ImportRow) {
  await tx
    .update(employees)
    .set({
      firstName: row.firstName,
      lastName: row.lastName,
      ...pickDefined(row, ["middleName", "middleInitial", "suffix"]),
    })
    .where(eq(employees.id, employeeId));
}

async function upsertEmployeeOwnedRow(
  tx: DbClient,
  table: EmployeeOwnedTable,
  employeeId: string,
  data: Record<string, unknown>,
) {
  const setData = removeUndefined(data);

  if (Object.keys(setData).length === 0) {
    await tx
      .insert(table)
      .values({ employeeId })
      .onConflictDoNothing({ target: [table.employeeId] });
    return;
  }

  await tx
    .insert(table)
    .values({ employeeId, ...setData })
    .onConflictDoUpdate({
      target: [table.employeeId],
      set: setData,
    });
}

function pickDefined<T extends string>(
  source: Partial<Record<T, unknown>>,
  fields: T[],
) {
  const picked: Record<string, unknown> = {};

  for (const field of fields) {
    const value = source[field];
    if (value !== undefined) picked[field] = value;
  }

  return picked;
}

function removeUndefined(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
}

function withNewEmployeeDefaults(
  isNewEmployee: boolean,
  defaults: Record<string, unknown>,
  data: Record<string, unknown>,
) {
  return isNewEmployee ? { ...defaults, ...data } : data;
}

function calculateAge(dateString: string) {
  const birthday = new Date(`${dateString}T00:00:00`);
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const monthDiff = today.getMonth() - birthday.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthday.getDate())) {
    age -= 1;
  }

  return Number.isFinite(age) ? age : null;
}
