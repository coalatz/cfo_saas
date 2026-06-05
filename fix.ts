import "dotenv/config";
import { getDb } from "./server/db.ts";
import { agentPipelines } from "./drizzle/schema.ts";
import { eq } from "drizzle-orm";

async function fix() {
  const db = await getDb();
  if (!db) {
    console.error("No DB connection");
    process.exit(1);
  }
  await db.update(agentPipelines).set({ status: "failed", errorMessage: "Execução interrompida" }).where(eq(agentPipelines.status, "running"));
  console.log("Zombies fixed!");
  process.exit(0);
}
fix();
