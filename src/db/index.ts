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

// Explicitly opted-in, loopback-only restored-database acceptance environment.
// Production connections always retain Neon's normal encrypted transport.
if (process.env.PAYROLL_LOCAL_REHEARSAL_PROXY_PORT) {
  const target = new URL(process.env.DATABASE_URL ?? "");
  const proxyPort = process.env.PAYROLL_LOCAL_REHEARSAL_PROXY_PORT;
  if (target.hostname !== "127.0.0.1" || !/^\d{4,5}$/.test(proxyPort)) {
    throw new Error("Payroll rehearsal transport requires a loopback database and explicit local proxy port.");
  }
  neonConfig.wsProxy = () => `127.0.0.1:${proxyPort}`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineConnect = false;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbClient = typeof db | DbTransaction;
export type DbInsertClient = Pick<typeof db, "insert">;
