import { SQLWrapper, sql } from "drizzle-orm";

export function employeeCodeSql(args: {
  employeeType: SQLWrapper;
  employeeNo: SQLWrapper;
}) {
  return sql<string>`concat(${args.employeeType}, ${args.employeeNo})`;
}

