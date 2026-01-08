import { migrate } from "drizzle-orm/neon-http/migrator";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema"; // Adjust path as needed
import { config } from "dotenv";



config({ path: ".env.local" });

// Use HTTP client instead of pool
const sql = neon(process.env.DATABASE_URL!);

// Create the Drizzle DB for migration with HTTP client
const db = drizzle(sql, { schema });

const main = async () => {
  try {
    await migrate(db, {
      migrationsFolder: "src/db/migrations",
    });
    console.log("Migration Complete");
  } catch (error) {
    console.error("Error during migration", error);
    process.exit(1);
  }
};

main();