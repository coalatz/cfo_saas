import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  InsertUser,
  agentModelConfigs,
  agentPipelines,
  canonicalInvoices,
  canonicalReceivables,
  canonicalPayables,
  canonicalCustomers,
  erpConfigs,
  extractionLogs,
  tenants,
  users,
  type AgentModelConfig,
  type AgentPipeline,
  type CanonicalInvoice,
  type CanonicalReceivable,
  type CanonicalPayable,
  type CanonicalCustomer,
  type ErpConfig,
  type ExtractionLog,
  type InsertAgentModelConfig,
  type InsertAgentPipeline,
  type InsertCanonicalInvoice,
  type InsertCanonicalReceivable,
  type InsertCanonicalPayable,
  type InsertCanonicalCustomer,
  type InsertErpConfig,
  type InsertExtractionLog,
  type InsertTenant,
  type Tenant,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      });
      _db = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;

  textFields.forEach((field) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  });

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Tenants ──────────────────────────────────────────────────────────────────

export async function listTenants(): Promise<Tenant[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tenants).orderBy(desc(tenants.createdAt));
}

export async function getTenantById(id: number): Promise<Tenant | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return result[0];
}

export async function createTenant(data: InsertTenant): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  const result = await db.insert(tenants).values({
    ...data,
    description: data.description ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return (result[0] as any).insertId as number;
}

export async function updateTenant(id: number, data: Partial<InsertTenant>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(tenants).set(data).where(eq(tenants.id, id));
}

export async function deleteTenant(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(tenants).where(eq(tenants.id, id));
}

// ─── ERP Configs ──────────────────────────────────────────────────────────────

export async function getErpConfigsByTenant(tenantId: number): Promise<ErpConfig[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(erpConfigs).where(eq(erpConfigs.tenantId, tenantId));
}

export async function getErpConfig(tenantId: number, erpType: string): Promise<ErpConfig | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(erpConfigs)
    .where(and(eq(erpConfigs.tenantId, tenantId), eq(erpConfigs.erpType, erpType)))
    .limit(1);
  return result[0];
}

export async function upsertErpConfig(data: InsertErpConfig): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await getErpConfig(data.tenantId as number, data.erpType);
  if (existing) {
    await db
      .update(erpConfigs)
      .set({ credentials: data.credentials, docUrl: data.docUrl ?? existing.docUrl, status: data.status ?? "configured" })
      .where(eq(erpConfigs.id, existing.id));
    return existing.id;
  }
  const result = await db.insert(erpConfigs).values({ ...data, status: "configured" });
  return (result[0] as any).insertId as number;
}

// ─── Agent Pipelines ──────────────────────────────────────────────────────────

export async function createPipeline(data: InsertAgentPipeline): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(agentPipelines).values(data);
  return (result[0] as any).insertId as number;
}

export async function updatePipeline(id: number, data: Partial<AgentPipeline>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(agentPipelines).set(data as any).where(eq(agentPipelines.id, id));
}

export async function getPipelinesByTenant(tenantId: number): Promise<AgentPipeline[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(agentPipelines)
    .where(eq(agentPipelines.tenantId, tenantId))
    .orderBy(desc(agentPipelines.startedAt));
}

export async function getLatestPipeline(tenantId: number, erpType: string): Promise<AgentPipeline | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(agentPipelines)
    .where(and(eq(agentPipelines.tenantId, tenantId), eq(agentPipelines.erpType, erpType)))
    .orderBy(desc(agentPipelines.startedAt))
    .limit(1);
  return result[0];
}

// ─── Canonical Invoices ───────────────────────────────────────────────────────

export async function upsertInvoice(data: InsertCanonicalInvoice): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(canonicalInvoices)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        customerName: data.customerName,
        issueDate: data.issueDate,
        grossAmount: data.grossAmount,
        rawStorageKey: data.rawStorageKey,
        updatedAt: new Date(),
      },
    });
}

export async function listInvoices(params: {
  tenantId?: number;
  source?: string;
  status?: "open" | "paid" | "overdue" | "cancelled";
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}): Promise<{ invoices: CanonicalInvoice[]; total: number }> {
  const db = await getDb();
  if (!db) return { invoices: [], total: 0 };

  const conditions = [];
  if (params.tenantId) conditions.push(eq(canonicalInvoices.tenantId, params.tenantId));
  if (params.source) conditions.push(eq(canonicalInvoices.source, params.source));
  if (params.status) conditions.push(eq(canonicalInvoices.status, params.status));
  if (params.dateFrom) conditions.push(sql`${canonicalInvoices.issueDate} >= ${params.dateFrom}`);
  if (params.dateTo) conditions.push(sql`${canonicalInvoices.issueDate} <= ${params.dateTo}`);

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [invoices, countResult] = await Promise.all([
    db.select().from(canonicalInvoices).where(where).orderBy(desc(canonicalInvoices.createdAt)).limit(params.limit ?? 50).offset(params.offset ?? 0),
    db.select({ count: sql<number>`count(*)` }).from(canonicalInvoices).where(where),
  ]);

  return { invoices, total: Number(countResult[0]?.count ?? 0) };
}

export async function getInvoiceStats(tenantId?: number) {
  const db = await getDb();
  if (!db) return null;
  const conditions = tenantId ? [eq(canonicalInvoices.tenantId, tenantId)] : [];
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const result = await db
    .select({
      total: sql<number>`count(*)`,
      totalAmount: sql<number>`COALESCE(sum(grossAmount), 0)`,
      openCount: sql<number>`sum(case when status = 'open' then 1 else 0 end)`,
      paidCount: sql<number>`sum(case when status = 'paid' then 1 else 0 end)`,
      overdueCount: sql<number>`sum(case when status = 'overdue' then 1 else 0 end)`,
      contaAzulCount: sql<number>`sum(case when source = 'conta_azul' then 1 else 0 end)`,
      omieCount: sql<number>`sum(case when source = 'omie' then 1 else 0 end)`,
    })
    .from(canonicalInvoices)
    .where(where);
  return result[0] ?? null;
}

// ─── Canonical Receivables ────────────────────────────────────────────────────

export async function upsertReceivable(data: InsertCanonicalReceivable): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(canonicalReceivables)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        customerName: data.customerName,
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        grossAmount: data.grossAmount,
        paidAmount: data.paidAmount,
        status: data.status,
        rawStorageKey: data.rawStorageKey,
        updatedAt: new Date(),
      },
    });
}

export async function listReceivables(params: {
  tenantId?: number;
  source?: string;
  status?: "open" | "paid" | "overdue" | "cancelled" | "partial";
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}): Promise<{ receivables: CanonicalReceivable[]; total: number }> {
  const db = await getDb();
  if (!db) return { receivables: [], total: 0 };

  const conditions = [];
  if (params.tenantId) conditions.push(eq(canonicalReceivables.tenantId, params.tenantId));
  if (params.source) conditions.push(eq(canonicalReceivables.source, params.source));
  if (params.status) conditions.push(eq(canonicalReceivables.status, params.status));
  if (params.dateFrom) conditions.push(sql`${canonicalReceivables.dueDate} >= ${params.dateFrom}`);
  if (params.dateTo) conditions.push(sql`${canonicalReceivables.dueDate} <= ${params.dateTo}`);

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [receivables, countResult] = await Promise.all([
    db.select().from(canonicalReceivables).where(where).orderBy(desc(canonicalReceivables.dueDate)).limit(params.limit ?? 50).offset(params.offset ?? 0),
    db.select({ count: sql<number>`count(*)` }).from(canonicalReceivables).where(where),
  ]);

  return { receivables, total: Number(countResult[0]?.count ?? 0) };
}

export async function getReceivableStats(tenantId?: number) {
  const db = await getDb();
  if (!db) return null;
  const conditions = tenantId ? [eq(canonicalReceivables.tenantId, tenantId)] : [];
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const result = await db
    .select({
      total: sql<number>`count(*)`,
      totalAmount: sql<number>`COALESCE(sum(grossAmount), 0)`,
      paidAmount: sql<number>`COALESCE(sum(paidAmount), 0)`,
      openCount: sql<number>`sum(case when status = 'open' then 1 else 0 end)`,
      paidCount: sql<number>`sum(case when status = 'paid' then 1 else 0 end)`,
      overdueCount: sql<number>`sum(case when status = 'overdue' then 1 else 0 end)`,
      partialCount: sql<number>`sum(case when status = 'partial' then 1 else 0 end)`,
    })
    .from(canonicalReceivables)
    .where(where);
  return result[0] ?? null;
}

// ─── Canonical Payables ───────────────────────────────────────────────────────

export async function upsertPayable(data: InsertCanonicalPayable): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(canonicalPayables)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        supplierName: data.supplierName,
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        grossAmount: data.grossAmount,
        paidAmount: data.paidAmount,
        status: data.status,
        category: data.category,
        rawStorageKey: data.rawStorageKey,
        updatedAt: new Date(),
      },
    });
}

export async function listPayables(params: {
  tenantId?: number;
  source?: string;
  status?: "open" | "paid" | "overdue" | "cancelled" | "partial";
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}): Promise<{ payables: CanonicalPayable[]; total: number }> {
  const db = await getDb();
  if (!db) return { payables: [], total: 0 };

  const conditions = [];
  if (params.tenantId) conditions.push(eq(canonicalPayables.tenantId, params.tenantId));
  if (params.source) conditions.push(eq(canonicalPayables.source, params.source));
  if (params.status) conditions.push(eq(canonicalPayables.status, params.status));
  if (params.dateFrom) conditions.push(sql`${canonicalPayables.dueDate} >= ${params.dateFrom}`);
  if (params.dateTo) conditions.push(sql`${canonicalPayables.dueDate} <= ${params.dateTo}`);

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [payables, countResult] = await Promise.all([
    db.select().from(canonicalPayables).where(where).orderBy(desc(canonicalPayables.dueDate)).limit(params.limit ?? 50).offset(params.offset ?? 0),
    db.select({ count: sql<number>`count(*)` }).from(canonicalPayables).where(where),
  ]);

  return { payables, total: Number(countResult[0]?.count ?? 0) };
}

export async function getPayableStats(tenantId?: number) {
  const db = await getDb();
  if (!db) return null;
  const conditions = tenantId ? [eq(canonicalPayables.tenantId, tenantId)] : [];
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const result = await db
    .select({
      total: sql<number>`count(*)`,
      totalAmount: sql<number>`COALESCE(sum(grossAmount), 0)`,
      paidAmount: sql<number>`COALESCE(sum(paidAmount), 0)`,
      openCount: sql<number>`sum(case when status = 'open' then 1 else 0 end)`,
      paidCount: sql<number>`sum(case when status = 'paid' then 1 else 0 end)`,
      overdueCount: sql<number>`sum(case when status = 'overdue' then 1 else 0 end)`,
      partialCount: sql<number>`sum(case when status = 'partial' then 1 else 0 end)`,
    })
    .from(canonicalPayables)
    .where(where);
  return result[0] ?? null;
}

// ─── Canonical Customers ──────────────────────────────────────────────────────

export async function upsertCustomer(data: InsertCanonicalCustomer): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(canonicalCustomers)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        name: data.name,
        tradeName: data.tradeName,
        document: data.document,
        documentType: data.documentType,
        email: data.email,
        phone: data.phone,
        city: data.city,
        state: data.state,
        status: data.status,
        rawStorageKey: data.rawStorageKey,
        updatedAt: new Date(),
      },
    });
}

export async function listCustomers(params: {
  tenantId?: number;
  source?: string;
  status?: "active" | "inactive" | "blocked";
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ customers: CanonicalCustomer[]; total: number }> {
  const db = await getDb();
  if (!db) return { customers: [], total: 0 };

  const conditions = [];
  if (params.tenantId) conditions.push(eq(canonicalCustomers.tenantId, params.tenantId));
  if (params.source) conditions.push(eq(canonicalCustomers.source, params.source));
  if (params.status) conditions.push(eq(canonicalCustomers.status, params.status));
  if (params.search) conditions.push(sql`${canonicalCustomers.name} LIKE ${`%${params.search}%`}`);

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [customers, countResult] = await Promise.all([
    db.select().from(canonicalCustomers).where(where).orderBy(canonicalCustomers.name).limit(params.limit ?? 50).offset(params.offset ?? 0),
    db.select({ count: sql<number>`count(*)` }).from(canonicalCustomers).where(where),
  ]);

  return { customers, total: Number(countResult[0]?.count ?? 0) };
}

export async function getCustomerStats(tenantId?: number) {
  const db = await getDb();
  if (!db) return null;
  const conditions = tenantId ? [eq(canonicalCustomers.tenantId, tenantId)] : [];
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const result = await db
    .select({
      total: sql<number>`count(*)`,
      activeCount: sql<number>`sum(case when status = 'active' then 1 else 0 end)`,
      inactiveCount: sql<number>`sum(case when status = 'inactive' then 1 else 0 end)`,
      cnpjCount: sql<number>`sum(case when documentType = 'cnpj' then 1 else 0 end)`,
      cpfCount: sql<number>`sum(case when documentType = 'cpf' then 1 else 0 end)`,
    })
    .from(canonicalCustomers)
    .where(where);
  return result[0] ?? null;
}

// ─── Extraction Logs ──────────────────────────────────────────────────────────

export async function createExtractionLog(data: InsertExtractionLog): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(extractionLogs).values(data);
  return (result[0] as any).insertId as number;
}

export async function updateExtractionLog(id: number, data: Partial<ExtractionLog>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(extractionLogs).set(data as any).where(eq(extractionLogs.id, id));
}

export async function listExtractionLogs(tenantId?: number): Promise<ExtractionLog[]> {
  const db = await getDb();
  if (!db) return [];
  const where = tenantId ? eq(extractionLogs.tenantId, tenantId) : undefined;
  return db
    .select()
    .from(extractionLogs)
    .where(where)
    .orderBy(desc(extractionLogs.startedAt))
    .limit(100);
}

// ─── Agent Model Configs ──────────────────────────────────────────────────────────────────

import type { ModelConfig, ModelProvider } from "./llmFactory";

/**
 * Get the model config for a specific agent and tenant.
 * Falls back to global default (tenantId=0), then to code defaults.
 */
export async function getModelConfig(
  tenantId: number,
  agentName: "discovery" | "mapping" | "generator" | "extractor"
): Promise<ModelConfig | null> {
  const db = await getDb();
  if (!db) return null;

  // Try tenant-specific first, then global default
  const rows = await db
    .select()
    .from(agentModelConfigs)
    .where(
      and(
        eq(agentModelConfigs.agentName, agentName),
        sql`${agentModelConfigs.tenantId} IN (${tenantId}, 0)`
      )
    )
    .orderBy(desc(agentModelConfigs.tenantId)) // tenant-specific (higher id) first
    .limit(10);

  // Find tenant-specific or fall back to global
  const match = rows.find((r) => r.tenantId === tenantId) ?? rows.find((r) => r.tenantId === 0);
  if (!match) return null;

  return {
    provider: match.provider as ModelProvider,
    modelId: match.modelId,
    temperature: match.temperature ? parseFloat(String(match.temperature)) : 0.1,
    maxTokens: match.maxTokens ?? 2048,
    apiKey: match.apiKey ?? undefined,
  };
}

export async function listModelConfigs(tenantId: number): Promise<AgentModelConfig[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(agentModelConfigs)
    .where(eq(agentModelConfigs.tenantId, tenantId))
    .orderBy(agentModelConfigs.agentName);
}

export async function saveModelConfig(data: InsertAgentModelConfig): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(agentModelConfigs)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        provider: data.provider,
        modelId: data.modelId,
        temperature: data.temperature,
        maxTokens: data.maxTokens,
        apiKey: data.apiKey,
      },
    });
}

export async function deleteModelConfig(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(agentModelConfigs).where(eq(agentModelConfigs.id, id));
}
