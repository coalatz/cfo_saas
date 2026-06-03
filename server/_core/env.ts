export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? process.env.MANUS_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "gpt-4o",
};

const resolvedUrl = ENV.forgeApiUrl || "http://localhost:11434 (default)";
console.log(`[ENV] Forge API URL: ${resolvedUrl}`);
console.log(`[ENV] Forge API Key: ${ENV.forgeApiKey ? `configurada (${ENV.forgeApiKey.slice(0, 8)}...)` : "NAO CONFIGURADA ❌"}`);
console.log(`[ENV] LLM Model: ${ENV.llmModel}`);
