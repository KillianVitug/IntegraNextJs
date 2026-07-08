import { db } from "@/db";
import { customPayrollDefinitions } from "@/db/schema";
import { eq,} from "drizzle-orm";

export async function getPayrollCode(id: number) {
    return db.query.customPayrollDefinitions.findFirst({
      where: eq(customPayrollDefinitions.id, id),
      with: {
        contributionGroups: {
          with: {
            flags: true,
          },
        },
      },
    });
  }
