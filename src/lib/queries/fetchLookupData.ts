"use server"; // Ensures it runs only on the server

import { db } from "@/db";
import { department, position, slvlGroup } from "@/db/schema";

export async function fetchDepartments() {
    try {
        return await db.select().from(department);
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
