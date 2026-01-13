"use server";

import { db } from "@/db";
import { employees } from "@/db/schema";
import { isNull } from "drizzle-orm";

export async function getActiveEmployees() {
    try {
        const activeEmployees = await db
            .select({
                id: employees.id,
                employeeNo: employees.employeeNo,
                firstName: employees.firstName,
                lastName: employees.lastName,
            })
            .from(employees)
            .where(isNull(employees.deletedAt))
            .orderBy(employees.lastName);

        return { data: activeEmployees, error: null };
    } catch (error) {
        console.error("Error fetching employees:", error);
        return { data: null, error: "Failed to fetch employees" };
    }
} 