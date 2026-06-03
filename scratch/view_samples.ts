import { getDb } from "../server/db";
import { agentPipelines } from "../drizzle/schema";
import { desc } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) {
    console.log("No DB connection");
    process.exit(1);
  }

  const latestPipeline = await db.select().from(agentPipelines).orderBy(desc(agentPipelines.startedAt)).limit(1).then(r => r[0]);

  console.log("Mapping Result:");
  console.log(JSON.stringify(latestPipeline.mappingResult, null, 2));

  console.log("\nGenerator Result (extractor.js snippet):");
  const extjs = (latestPipeline.generatorResult as any)?.extractorCode || "";
  console.log(extjs.substring(0, 500));

  
  process.exit(0);
}

main().catch(console.error);
