import { isEmployeeType, type EmployeeType } from "@/utils/employeeCode";

const COMBINED_EMPLOYEE_NO_PATTERN = /^(EMP|ADMIN)[\s-]*([0-9]+)$/i;

type EmployeeNameSortInput = {
  id?: string | number | null;
  employeeId?: string | number | null;
  employeeNo?: string | number | null;
  employeeNoSnapshot?: string | number | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  employeeName?: string | null;
  employeeNameSnapshot?: string | null;
  fallbackName?: string | null;
};

const employeeNameSortCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function normalizeEmployeeSortText(value: unknown) {
  if (value == null) return "";
  return String(value).trim().replace(/\s+/g, " ");
}

function parseEmployeeDisplayName(value: unknown) {
  const displayName = normalizeEmployeeSortText(value);
  if (!displayName) {
    return { lastName: "", firstName: "", middleName: "" };
  }

  const commaIndex = displayName.indexOf(",");
  if (commaIndex === -1) {
    return { lastName: displayName, firstName: "", middleName: "" };
  }

  const givenNames = normalizeEmployeeSortText(
    displayName.slice(commaIndex + 1)
  );
  const [firstName = "", ...middleNameParts] = givenNames.split(" ");

  return {
    lastName: normalizeEmployeeSortText(displayName.slice(0, commaIndex)),
    firstName,
    middleName: middleNameParts.join(" "),
  };
}

function getEmployeeSortParts(employee: EmployeeNameSortInput) {
  const parsedName = parseEmployeeDisplayName(
    employee.employeeName ?? employee.employeeNameSnapshot ?? employee.fallbackName
  );

  return {
    lastName:
      normalizeEmployeeSortText(employee.lastName) || parsedName.lastName,
    firstName:
      normalizeEmployeeSortText(employee.firstName) || parsedName.firstName,
    middleName:
      normalizeEmployeeSortText(employee.middleName) || parsedName.middleName,
    employeeNo: normalizeEmployeeSortText(
      employee.employeeNo ?? employee.employeeNoSnapshot
    ),
    id: normalizeEmployeeSortText(employee.employeeId ?? employee.id),
  };
}

export function compareEmployeesByLastName(
  left: EmployeeNameSortInput,
  right: EmployeeNameSortInput
) {
  const leftParts = getEmployeeSortParts(left);
  const rightParts = getEmployeeSortParts(right);
  const sortKeys = [
    "lastName",
    "firstName",
    "middleName",
    "employeeNo",
    "id",
  ] as const;

  for (const key of sortKeys) {
    const comparison = employeeNameSortCollator.compare(
      leftParts[key],
      rightParts[key]
    );
    if (comparison !== 0) return comparison;
  }

  return 0;
}

export function sortEmployeesByLastName<T extends EmployeeNameSortInput>(
  employees: readonly T[]
) {
  return [...employees].sort(compareEmployeesByLastName);
}

export function formatEmployeeNoDisplay(value: string | null | undefined) {
  const employeeNo = value?.trim() ?? "";
  if (!employeeNo) return "";

  const combinedMatch = employeeNo.match(COMBINED_EMPLOYEE_NO_PATTERN);
  return combinedMatch ? combinedMatch[2] : employeeNo;
}

export function getEmployeeTypeDisplay(args: {
  employeeType?: string | null;
  employeeNo?: string | null;
}) {
  if (isEmployeeType(args.employeeType)) {
    return args.employeeType;
  }

  const employeeNo = args.employeeNo?.trim() ?? "";
  const combinedMatch = employeeNo.match(COMBINED_EMPLOYEE_NO_PATTERN);
  const employeeType = combinedMatch?.[1]?.toUpperCase();

  return isEmployeeType(employeeType) ? employeeType : "";
}

export function formatEmployeePickerLabel(args: {
  firstName?: string | null;
  lastName?: string | null;
  middleName?: string | null;
  employeeNo?: string | null;
  employeeType?: EmployeeType | string | null;
  fallbackName?: string;
}) {
  const givenNames = [args.firstName, args.middleName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const name =
    [args.lastName, givenNames].filter(Boolean).join(", ").trim() ||
    args.fallbackName ||
    "Saved employee";
  const employeeNo = formatEmployeeNoDisplay(args.employeeNo);
  const employeeType = getEmployeeTypeDisplay(args);

  return [
    employeeNo ? `${name} (${employeeNo})` : name,
    employeeType,
  ]
    .filter(Boolean)
    .join(" - ");
}
