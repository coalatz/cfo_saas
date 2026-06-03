import mysql from "mysql2/promise";

const conn = await mysql.createConnection("mysql://root:root@localhost:3306/cfo_saas_db");

const [tables] = await conn.execute("SHOW TABLES");
console.log("\n=== TABELAS ===");
tables.forEach(t => console.log(" -", Object.values(t)[0]));

for (const entity of ["invoices", "receivables", "payables", "customers"]) {
  try {
    const [[{ total }]] = await conn.execute(`SELECT COUNT(*) as total FROM \`${entity}\``);
    console.log(`\n=== ${entity.toUpperCase()} (${total} registros) ===`);
    if (total > 0) {
      const [rows] = await conn.execute(`SELECT * FROM \`${entity}\` LIMIT 2`);
      rows.forEach(r => console.log(JSON.stringify(r, null, 2)));
    }
  } catch (e) {
    console.log(`${entity}: tabela não existe ou erro — ${e.message}`);
  }
}

await conn.end();
