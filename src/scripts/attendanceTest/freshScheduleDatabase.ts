import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { SQL, is } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { db, DbClient } from "@/db";

/** New in-memory database, no environment URL or private/restored data.
 * Materializes current columns/defaults/NOT NULL/primary keys and ordinary unique
 * indexes. Migration compatibility/FKs are separately verified by verifyShiftCatalog. */
export async function freshScheduleDatabase() {
  const pg = new PGlite(), database = drizzle(pg, { schema }), dialect = new PgDialect();
  const enums = new Set<string>();
  for (const table of Object.values(schema).filter(value => is(value, PgTable))) {
    const config = getTableConfig(table), columns: string[] = [];
    for (const column of config.columns) {
      const type = column.getSQLType();
      if (column.enumValues?.length && !enums.has(type)) {
        await pg.exec(`CREATE TYPE "${type}" AS ENUM (${column.enumValues.map(value => `'${value.replaceAll("'", "''")}'`).join(",")})`);
        enums.add(type);
      }
      const literal = (value: unknown) => typeof value === "string" || typeof value === "object"
        ? `'${(typeof value === "object" ? JSON.stringify(value) : value as string).replaceAll("'", "''")}'` : String(value);
      const defaultSql = is(column.default, SQL) ? dialect.sqlToQuery(column.default).sql : column.default !== undefined ? literal(column.default) : null;
      columns.push(`"${column.name}" ${type}${defaultSql == null ? "" : ` DEFAULT ${defaultSql}`}${column.notNull ? " NOT NULL" : ""}${column.primary ? " PRIMARY KEY" : ""}${column.isUnique ? " UNIQUE" : ""}`);
    }
    for (const key of config.primaryKeys) columns.push(`PRIMARY KEY (${key.columns.map(column => `"${column.name}"`).join(",")})`);
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`);
    for (const index of config.indexes) {
      if (!index.config.unique || index.config.where || index.config.columns.some(column => is(column, SQL))) continue;
      await pg.exec(`CREATE UNIQUE INDEX "${index.config.name}" ON "${config.name}" (${index.config.columns.map(column => `"${"name" in column ? column.name : ""}"`).join(",")})`);
    }
  }
  return { pg, database, client: database as unknown as DbClient, transactional: database as unknown as typeof db };
}
