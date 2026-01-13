import { db } from "@/db";
import { customPayrollDefinitions, } from "@/db/schema";
import { eq,} from "drizzle-orm";

export async function getPayrollCode(code: string) {
    const employee = await db.query.customPayrollDefinitions.findFirst({
        where: eq(customPayrollDefinitions.code, code)
    });
    return employee;
}
