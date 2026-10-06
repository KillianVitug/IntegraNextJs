import { pgTable, uuid, date, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { employees } from "./schema";
export const monthlyPayrollSettings=pgTable("monthly_payroll_settings",{
 employeeId:uuid("employee_id").notNull().references(()=>employees.id),
 effectiveMonth:date("effective_month").notNull(),
 payoutHalf:text("payout_half").$type<"A"|"B">().notNull().default("B"),
 actor:text("actor").notNull(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},table=>[primaryKey({columns:[table.employeeId,table.effectiveMonth]})]);
