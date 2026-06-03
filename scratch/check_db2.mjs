import mysql from "mysql2/promise";

const conn = await mysql.createConnection("mysql://root:root@localhost:3306/cfo_saas_db");

// Receivables da Omie
const [recv] = await conn.execute(
  "SELECT externalId, customerName, issueDate, dueDate, grossAmount, rawStorageKey FROM canonical_receivables WHERE source='omie' LIMIT 3"
);
console.log("=== RECEIVABLES SAMPLE (omie) ===");
recv.forEach(r => console.log(JSON.stringify(r)));

// Payables da Omie
const [pay] = await conn.execute(
  "SELECT externalId, supplierName, issueDate, dueDate, grossAmount, rawStorageKey FROM canonical_payables WHERE source='omie' LIMIT 3"
);
console.log("\n=== PAYABLES SAMPLE (omie) ===");
pay.forEach(r => console.log(JSON.stringify(r)));

// Customers duplicados
const [dup] = await conn.execute(
  "SELECT externalId, name, COUNT(*) as cnt FROM canonical_customers WHERE source='omie' GROUP BY externalId, name ORDER BY cnt DESC LIMIT 8"
);
console.log("\n=== CUSTOMERS DUPLICADOS (omie) ===");
dup.forEach(r => console.log(JSON.stringify(r)));

// Customers com externalId vazio
const [[{ vazios }]] = await conn.execute(
  "SELECT COUNT(*) as vazios FROM canonical_customers WHERE source='omie' AND (externalId IS NULL OR externalId='')"
);
console.log(`\nCustomers com externalId vazio: ${vazios}`);

await conn.end();
