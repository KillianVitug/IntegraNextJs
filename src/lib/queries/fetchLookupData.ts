"use server";

import { db } from "@/db";
import { department, position, slvlGroup, accountCode, customPayrollDefinitions } from "@/db/schema";
import { asc, eq, isNull } from "drizzle-orm";

export async function fetchDepartments() {
    try {
      const result = await db.select().from(department);
      return result;
    } catch (error) {
      console.error("Error fetching departments:", error);
      return [];
    }
  }
  
export async function fetchSlVl() {
    try {
        return await db.select().from(slvlGroup);
    } catch (error) {
        console.error("Error fetching departments:", error);
        return [];
    }
}

export async function fetchPositions() {
    try {
        return await db.select().from(position);
    } catch (error) {
        console.error("Error fetching departments:", error);
        return [];
    }
}
export async function fetchAccountCode() {
    try {
        return await db.select().from(accountCode);
    } catch (error) {
        console.error("Error fetching departments:", error);
        return [];
    }
}


export async function fetchCustomPayroll() {
    const results = await db.select({
        id: customPayrollDefinitions.id,
        code: customPayrollDefinitions.code,
        description: customPayrollDefinitions.description,
        rateDivisor: customPayrollDefinitions.rateDivisor
    })
    .from(customPayrollDefinitions)
    .where(isNull(customPayrollDefinitions.deletedAt)) // ? This is the fix
    .orderBy(asc(customPayrollDefinitions.code))
    return results
}



