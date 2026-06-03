import "dotenv/config";
import { upsertErpConfig } from "../server/db";

async function main() {
  try {
    const tenantId = 1; // Assumindo tenant padrão 1 para testes
    await upsertErpConfig({
      tenantId,
      erpType: "omie",
      docUrl: "https://developer.omie.com.br/service-list/",
      credentials: {
        app_key: "7712237287755",
        app_secret: "7640397bb7ade266da7119024ca2675d"
      }
    });
    console.log("✅ Credenciais da Omie atualizadas com sucesso no banco de dados para o Tenant 1!");
  } catch (err) {
    console.error("❌ Falha ao atualizar credenciais:", err);
  }
  process.exit(0);
}

main();
