import { db } from "./server/db.ts";
import { agentPipelines } from "./drizzle/schema.ts";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import "dotenv/config";

async function fix() {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL as string });
  const db = drizzle(pool);
  await db.update(agentPipelines).set({ status: "failed", errorMessage: "Execução interrompida abruptamente." }).where(eq(agentPipelines.status, "running"));
  console.log("Zombies fixed!");
  process.exit(0);
}
fix();
