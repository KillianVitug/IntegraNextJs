// // src/actions/assignSlvlGroup.ts
// import { db } from "@/db";
// import { employeesSalary, employeesLeaveBalances, slvlGroup } from "@/db/schema";
// import { eq, and } from "drizzle-orm";
// import { z } from "zod";

// export async function assignSLVLGroup(employeeId: string, slvlGroupId: number) {
//   const currentYear = new Date().getFullYear();

//   // 1. Fetch SLVL group
//   const [group] = await db
//     .select({
//       defaultVacationLeave: slvlGroup.defaultVacationLeave,
//       defaultSickLeave: slvlGroup.defaultSickLeave,
//     })
//     .from(slvlGroup)
//     .where(eq(slvlGroup.id, slvlGroupId));

//   if (!group) throw new Error("SLVL group not found");

//   // 2. Update employee salary table
//   await db
//     .update(employeesSalary)
//     .set({
//       slvlGroupId,
//       updatedAt: new Date(),
//     })
//     .where(eq(employeesSalary.employeeId, employeeId));

//   // 3. Check if leave balance for the current year already exists
//   const existing = await db
//     .select()
//     .from(employeesLeaveBalances)
//     .where(
//       eq(employeesLeaveBalances.employeeId, employeeId)
//     )
//     .where(eq(employeesLeaveBalances.year, currentYear));

//   if (existing.length === 0) {
//     // 4. Insert leave balances
//     await db.insert(employeesLeaveBalances).values({
//       employeeId,
//       year: currentYear,
//       vacationLeave: group.defaultVacationLeave,
//       sickLeave: group.defaultSickLeave,
//       createdAt: new Date(),
//       updatedAt: new Date(),
//     });
//   }
// }

