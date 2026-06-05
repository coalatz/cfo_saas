import mysql from "mysql2/promise";
import "dotenv/config";

async function fix() {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL });
  const [result] = await pool.query('UPDATE agent_pipelines SET status="failed", errorMessage="Execução interrompida" WHERE status="running"');
  console.log("Zombies fixed!", result);
  process.exit(0);
}
fix().catch(console.error);
