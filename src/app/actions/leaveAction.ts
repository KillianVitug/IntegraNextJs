"use server";

import { db } from "@/db";
import { employees, employeesLeaveRecords } from "@/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
// import { SelectEmployeeLeaveSchemaType } from "@/zod-schemas/SickandLeaveSchema";

export type LeaveRecordWithEmployeeInfo = {
    id: number;
    employeeId: string;
    dateFiled: string;
    leaveType: "SL" | "VL";
    noOfDays: string;
    reason: string | null;
    leaveStatus: "Pending" | "Approved" | "Denied";
    employeeNo: string | null;
    firstName: string | null;
    lastName: string | null;
};

export async function createLeaveRecord(data: {
    employeeId: string;
    dateFiled: string;
    leaveType: "SL" | "VL";
    noOfDays: number;
    reason: string;
    leaveStatus: "Pending" | "Approved" | "Denied"; 
}) {
    try {
        const [record] = await db
            .insert(employeesLeaveRecords)
            .values({
                employeeId: data.employeeId,
                dateFiled: data.dateFiled,
                leaveType: data.leaveType,
                noOfDays: data.noOfDays.toString(),
                reason: data.reason,
                leaveStatus: data.leaveStatus,
            })
            .returning();

        revalidatePath("/leaves/form");
        return { data: record, error: null };
    } catch (error) {
        console.error("Error creating leave record:", error);
        return { data: null, error: "Failed to create leave record" };
    }
}

export async function getLeaveRecordsByYear(year: number) {
    try {
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;

        const records = await db
            .select({
                id: employeesLeaveRecords.id,
                employeeId: employeesLeaveRecords.employeeId,
                dateFiled: employeesLeaveRecords.dateFiled,
                leaveType: employeesLeaveRecords.leaveType,
                noOfDays: employeesLeaveRecords.noOfDays,
                reason: employeesLeaveRecords.reason,
                leaveStatus: employeesLeaveRecords.leaveStatus,
                employeeNo: employees.employeeNo,
                firstName: employees.firstName,
                lastName: employees.lastName,
            })
            .from(employeesLeaveRecords)
            .leftJoin(employees, eq(employeesLeaveRecords.employeeId, employees.id))
            .where(and(
                gte(employeesLeaveRecords.dateFiled, startDate),
                lte(employeesLeaveRecords.dateFiled, endDate)
            ))
            .orderBy(employeesLeaveRecords.dateFiled);

        return { data: records as LeaveRecordWithEmployeeInfo[], error: null };

    } catch (error) {
        console.error("Error fetching leave records:", error);
        return { data: null, error: "Failed to fetch leave records" };
    }
}

export async function updateLeaveRecord(data: {
    id: number;
    employeeId: string;
    dateFiled: string;
    leaveType: "SL" | "VL";
    noOfDays: number;
    reason: string;
    leaveStatus: "Pending" | "Approved" | "Denied";
}) {
    try {
        const [record] = await db
            .update(employeesLeaveRecords)
            .set({
                employeeId: data.employeeId,
                dateFiled: data.dateFiled,
                leaveType: data.leaveType,
                noOfDays: data.noOfDays.toString(),
                reason: data.reason,
                leaveStatus: data.leaveStatus,
            })
            .where(eq(employeesLeaveRecords.id, data.id))
            .returning();

        revalidatePath("/leaves/form");
        return { data: record, error: null };
    } catch (error) {
        console.error("Error updating leave record:", error);
        return { data: null, error: "Failed to update leave record" };
    }
}

export async function updateLeaveRecordStatus(id: number, leaveStatus: "Pending" | "Approved" | "Denied") {
    try {
        const [record] = await db
            .update(employeesLeaveRecords)
            .set({ leaveStatus })
            .where(eq(employeesLeaveRecords.id, id))
            .returning();

        revalidatePath("/leaves/form");
        return { data: record, error: null };
    } catch (error) {
        console.error("Error updating leave record:", error);
        return { data: null, error: "Failed to update leave record" };
    }
} 

export async function deleteLeaveRecord(id: number) {
    try {
        await db
            .delete(employeesLeaveRecords)
            .where(eq(employeesLeaveRecords.id, id));
        revalidatePath("/leaves/form");
        return { error: null };
    } catch (error) {
        console.error("Error deleting leave record:", error);
        return { error: "Failed to delete leave record" };
    }
}
