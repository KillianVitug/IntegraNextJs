// import { drizzle } from "drizzle-orm/neon-http";
// import { neon } from "@neondatabase/serverless";
// import { config } from "dotenv";
// import * as schema from "./schema"; // Import the schema

// config({ path: ".env.local" });

// const sql = neon(process.env.DATABASE_URL!);

// // Initialize Drizzle with schema
// export const db = drizzle(sql, { schema }); 

import { drizzle } from "drizzle-orm/neon-serverless"; // ✅ use neon-serverless here
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema"; // Import your schema
import { config } from "dotenv";

config({ path: ".env.local" });

// Create a Pool for WebSocket connections
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Drizzle instance with schema and WebSocket pool
export const db = drizzle(pool, { schema });