import { drizzle } from "drizzle-orm/neon-serverless";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
import ws from "ws";
import * as schema from "./schema";

if (process.env.NODE_ENV === "development") {
  config({ path: ".env.local" });
}

// Neon Pool needs an explicit WebSocket constructor in Node runtimes.
neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbClient = typeof db | DbTransaction;
export type DbInsertClient = Pick<typeof db, "insert">;
