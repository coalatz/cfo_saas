import mysql from "mysql2/promise";

const conn = await mysql.createConnection("mysql://root:root@localhost:3306/cfo_saas_db");

// Conta duplicados antes
for (const t of ["canonical_customers", "canonical_receivables", "canonical_payables", "canonical_invoices"]) {
  const [[{ total }]] = await conn.execute(`SELECT COUNT(*) as total FROM \`${t}\``);
  const [[{ uniq }]] = await conn.execute(
    `SELECT COUNT(*) as uniq FROM (SELECT MIN(id) as id FROM \`${t}\` GROUP BY tenantId, source, externalId) sub`
  );
  console.log(`${t}: ${total} registros → ${uniq} únicos (${Number(total) - Number(uniq)} duplicados para remover)`);
}

console.log("\n--- Removendo duplicados ---");

for (const t of ["canonical_customers", "canonical_receivables", "canonical_payables", "canonical_invoices"]) {
  const [result] = await conn.execute(`
    DELETE FROM \`${t}\`
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT MIN(id) as id FROM \`${t}\` GROUP BY tenantId, source, externalId
      ) sub
    )
  `);
  console.log(`${t}: ${result.affectedRows} duplicados removidos`);
}

// Conta após limpeza
console.log("\n--- Contagem após limpeza ---");
for (const t of ["canonical_customers", "canonical_receivables", "canonical_payables", "canonical_invoices"]) {
  const [[{ total }]] = await conn.execute(`SELECT COUNT(*) as total FROM \`${t}\``);
  console.log(`${t}: ${total} registros`);
}

await conn.end();
console.log("\n✅ Limpeza concluída. Pronto para rodar a migration.");
