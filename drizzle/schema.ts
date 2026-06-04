import {
  decimal,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Tenants ─────────────────────────────────────────────────────────────────

export const tenants = mysqlTable("tenants", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

// ─── ERP Configurations ───────────────────────────────────────────────────────

export const erpConfigs = mysqlTable("erp_configs", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: int("tenantId").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  erpType: varchar("erpType", { length: 50 }).notNull(),
  credentials: json("credentials").notNull(),
  docUrl: varchar("docUrl", { length: 1000 }),  // URL da documentação da API do ERP
  // OAuth2 fields (Conta Azul)
  oauthState: varchar("oauthState", { length: 128 }),   // CSRF state for pending OAuth flow
  refreshToken: text("refreshToken"),                   // long-lived refresh token
  tokenExpiresAt: timestamp("tokenExpiresAt"),           // when the current access_token expires
  status: mysqlEnum("status", ["pending", "configured", "active", "error"]).default("pending").notNull(),
  lastTestedAt: timestamp("lastTestedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ErpConfig = typeof erpConfigs.$inferSelect;
export type InsertErpConfig = typeof erpConfigs.$inferInsert;

// ─── Agent Pipelines ──────────────────────────────────────────────────────────

export const agentPipelines = mysqlTable("agent_pipelines", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: int("tenantId").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  erpType: varchar("erpType", { length: 50 }).notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed"]).default("pending").notNull(),
  currentStep: mysqlEnum("currentStep", ["discovery", "mapping", "generator", "extractor", "done"]).default("discovery").notNull(),
  discoveryResult: json("discoveryResult"),
  mappingResult: json("mappingResult"),
  generatorResult: json("generatorResult"),
  extractorResult: json("extractorResult"),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
});

export type AgentPipeline = typeof agentPipelines.$inferSelect;
export type InsertAgentPipeline = typeof agentPipelines.$inferInsert;

// ─── Canonical Invoices ───────────────────────────────────────────────────────

export const canonicalInvoices = mysqlTable("canonical_invoices", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: int("tenantId").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 50 }).notNull(),
  externalId: varchar("externalId", { length: 255 }).notNull(),
  customerName: varchar("customerName", { length: 255 }),
  issueDate: varchar("issueDate", { length: 10 }),
  grossAmount: decimal("grossAmount", { precision: 15, scale: 2 }),
  rawStorageKey: varchar("rawStorageKey", { length: 500 }),
  status: mysqlEnum("status", ["open", "paid", "overdue", "cancelled"]).default("open").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqTenantSourceExternal: uniqueIndex("uniq_tenant_source_external").on(table.tenantId, table.source, table.externalId),
}));

export type CanonicalInvoice = typeof canonicalInvoices.$inferSelect;
export type InsertCanonicalInvoice = typeof canonicalInvoices.$inferInsert;

// ─── Canonical Receivables (Contas a Receber) ─────────────────────────────────

export const canonicalReceivables = mysqlTable("canonical_receivables", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: int("tenantId").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 50 }).notNull(),
  externalId: varchar("externalId", { length: 255 }).notNull(),
  customerName: varchar("customerName", { length: 255 }),
  issueDate: varchar("issueDate", { length: 10 }),
  dueDate: varchar("dueDate", { length: 10 }),
  grossAmount: decimal("grossAmount", { precision: 15, scale: 2 }),
  paidAmount: decimal("paidAmount", { precision: 15, scale: 2 }),
  documentType: varchar("documentType", { length: 50 }),   // NF, boleto, duplicata, etc.
  documentNumber: varchar("documentNumber", { length: 100 }),
  status: mysqlEnum("status", ["open", "paid", "overdue", "cancelled", "partial"]).default("open").notNull(),
  rawStorageKey: varchar("rawStorageKey", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqTenantSourceExternal: uniqueIndex("uniq_tenant_source_external").on(table.tenantId, table.source, table.externalId),
}));

export type CanonicalReceivable = typeof canonicalReceivables.$inferSelect;
export type InsertCanonicalReceivable = typeof canonicalReceivables.$inferInsert;

// ─── Canonical Payables (Contas a Pagar) ─────────────────────────────────────

export const canonicalPayables = mysqlTable("canonical_payables", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: int("tenantId").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 50 }).notNull(),
  externalId: varchar("externalId", { length: 255 }).notNull(),
  supplierName: varchar("supplierName", { length: 255 }),
  issueDate: varchar("issueDate", { length: 10 }),
  dueDate: varchar("dueDate", { length: 10 }),
  grossAmount: decimal("grossAmount", { precision: 15, scale: 2 }),
  paidAmount: decimal("paidAmount", { precision: 15, scale: 2 }),
  documentType: varchar("documentType", { length: 50 }),
  documentNumber: varchar("documentNumber", { length: 100 }),
  category: varchar("category", { length: 100 }),          // categoria/centro de custo
  status: mysqlEnum("status", ["open", "paid", "overdue", "cancelled", "partial"]).default("open").notNull(),
  rawStorageKey: varchar("rawStorageKey", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqTenantSourceExternal: uniqueIndex("uniq_tenant_source_external").on(table.tenantId, table.source, table.externalId),
}));

export type CanonicalPayable = typeof canonicalPayables.$inferSelect;
export type InsertCanonicalPayable = typeof canonicalPayables.$inferInsert;

// ─── Canonical Customers (Clientes) ──────────────────────────────────────────

export const canonicalCustomers = mysqlTable("canonical_customers", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: int("tenantId").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 50 }).notNull(),
  externalId: varchar("externalId", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  tradeName: varchar("tradeName", { length: 255 }),         // nome fantasia
  document: varchar("document", { length: 20 }),            // CPF ou CNPJ (apenas dígitos)
  documentType: mysqlEnum("documentType", ["cpf", "cnpj", "other"]),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 30 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),
  country: varchar("country", { length: 2 }).default("BR"),
  status: mysqlEnum("status", ["active", "inactive", "blocked"]).default("active").notNull(),
  rawStorageKey: varchar("rawStorageKey", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqTenantSourceExternal: uniqueIndex("uniq_tenant_source_external").on(table.tenantId, table.source, table.externalId),
}));

export type CanonicalCustomer = typeof canonicalCustomers.$inferSelect;
export type InsertCanonicalCustomer = typeof canonicalCustomers.$inferInsert;

// ─── Extraction Logs ──────────────────────────────────────────────────────────

export const extractionLogs = mysqlTable("extraction_logs", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: int("tenantId").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  pipelineId: int("pipelineId").references(() => agentPipelines.id, { onDelete: "set null" }),
  erpType: varchar("erpType", { length: 50 }).notNull(),
  entityType: mysqlEnum("entityType", ["invoices", "receivables", "payables", "customers"]).default("invoices").notNull(),
  status: mysqlEnum("status", ["running", "success", "failed", "partial"]).default("running").notNull(),
  recordsProcessed: int("recordsProcessed").default(0),
  recordsFailed: int("recordsFailed").default(0),
  errorMessage: text("errorMessage"),
  metadata: json("metadata"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
});

export type ExtractionLog = typeof extractionLogs.$inferSelect;
export type InsertExtractionLog = typeof extractionLogs.$inferInsert;

// ─── Agent Model Configs ──────────────────────────────────────────────────────
// Stores which LLM model/provider each agent should use, per tenant.
// tenantId = 0 means global default.

export const agentModelConfigs = mysqlTable("agent_model_configs", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: int("tenantId").default(0).notNull(),  // 0 = global default
  agentName: mysqlEnum("agentName", ["discovery", "mapping", "generator", "generator_mapper", "extractor"]).notNull(),
  provider: varchar("provider", { length: 50 }).default("manus").notNull(),
  modelId: varchar("modelId", { length: 100 }).default("default").notNull(),
  temperature: decimal("temperature", { precision: 3, scale: 2 }).default("0.10"),
  maxTokens: int("maxTokens").default(2048),
  apiKey: varchar("apiKey", { length: 500 }),  // optional override; prefer env secrets
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqTenantAgent: uniqueIndex("uniq_tenant_agent").on(table.tenantId, table.agentName),
}));

export type AgentModelConfig = typeof agentModelConfigs.$inferSelect;
export type InsertAgentModelConfig = typeof agentModelConfigs.$inferInsert;
