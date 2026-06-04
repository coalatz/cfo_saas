import { runFullPipeline } from "./server/agentGraph.ts";

async function main() {
  const tenantId = 1;
  const erpName = "conta_azul";

  console.log(`🚀 Iniciando pipeline para ${erpName}...`);
  console.log(`📍 Tenant: ${tenantId}\n`);

  const result = await runFullPipeline(tenantId, erpName);

  console.log("\n✅ Pipeline finalizado:");
  console.log(JSON.stringify(result, null, 2));

  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
