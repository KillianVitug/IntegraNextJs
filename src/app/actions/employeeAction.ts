"use server";

import { db } from "@/db";
import { employees } from "@/db/schema";
import { asc, isNull } from "drizzle-orm";
import { requireAdminActor } from "@/lib/admin";
import { unstable_rethrow } from "next/navigation";

export async function getActiveEmployees() {
    try {
        await requireAdminActor();
        const activeEmployees = await db
            .select({
                id: employees.id,
                employeeNo: employees.employeeNo,
                employeeType: employees.employeeType,
                firstName: employees.firstName,
                middleName: employees.middleName,
                lastName: employees.lastName,
            })
            .from(employees)
            .where(isNull(employees.deletedAt))
            .orderBy(
                asc(employees.lastName),
                asc(employees.firstName),
                asc(employees.middleName),
                asc(employees.employeeNo),
                asc(employees.id)
            );

        return { data: activeEmployees, error: null };
    } catch (error) {
        unstable_rethrow(error);
        console.error("Error fetching employees:", error);
        return { data: null, error: "Failed to fetch employees" };
    }
} 
