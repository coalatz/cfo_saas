import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { runFullPipeline, runDiscoveryOnly } from "./agentGraph";
import {
  createTenant,
  deleteTenant,
  getErpConfigsByTenant,
  getInvoiceStats,
  getReceivableStats,
  getPayableStats,
  getCustomerStats,
  getTenantById,
  listExtractionLogs,
  listInvoices,
  listReceivables,
  listPayables,
  listCustomers,
  listModelConfigs,
  listTenants,
  saveModelConfig,
  deleteModelConfig,
  updateTenant,
  upsertErpConfig,
  getPipelinesByTenant,
  getLatestPipeline,
} from "./db";
import { AVAILABLE_MODELS } from "./llmFactory";

// ─── Tenants Router ───────────────────────────────────────────────────────────

const tenantsRouter = router({
  list: publicProcedure.query(async () => listTenants()),

  getById: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const tenant = await getTenantById(input.id);
    if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant não encontrado" });
    return tenant;
  }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(2).max(255),
      slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, "Slug deve conter apenas letras minúsculas, números e hífens"),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await createTenant({ name: input.name, slug: input.slug, description: input.description ?? null, status: "active" });
      return { id };
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(2).max(255).optional(),
      description: z.string().optional(),
      status: z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateTenant(id, data);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteTenant(input.id);
      return { success: true };
    }),
});

// ─── ERP Configs Router ───────────────────────────────────────────────────────

const erpConfigsRouter = router({
  getByTenant: publicProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ input }) => getErpConfigsByTenant(input.tenantId)),

  upsert: publicProcedure
    .input(z.object({
      tenantId: z.number(),
      erpType: z.enum(["conta_azul", "omie"]),
      credentials: z.record(z.string(), z.string()),
      docUrl: z.string().url().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await upsertErpConfig({
        tenantId: input.tenantId,
        erpType: input.erpType,
        credentials: input.credentials,
        docUrl: input.docUrl ?? null,
        status: "configured",
      });
      return { id };
    }),
});

// ─── Agents Router ────────────────────────────────────────────────────────────

const agentsRouter = router({
  runPipeline: publicProcedure
    .input(z.object({ tenantId: z.number(), erpType: z.string() }))
    .mutation(async ({ input }) => {
      const result = await runFullPipeline(input.tenantId, input.erpType);
      return result;
    }),

  getPipelines: publicProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ input }) => getPipelinesByTenant(input.tenantId)),

  getLatestPipeline: publicProcedure
    .input(z.object({ tenantId: z.number(), erpType: z.string() }))
    .query(async ({ input }) => getLatestPipeline(input.tenantId, input.erpType)),

  // Run only the Discovery node — useful for testing a doc URL
  testDiscovery: publicProcedure
    .input(z.object({
      erpType: z.enum(["conta_azul", "omie"]),
      docUrl: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      const result = await runDiscoveryOnly(input.erpType, input.docUrl);
      return result;
    }),

  getPipelineLogs: publicProcedure
    .input(z.object({ pipelineId: z.number() }))
    .query(async ({ input }) => {
      const { getLogs } = await import("./logger");
      return getLogs(input.pipelineId);
    }),
});

// ─── Model Configs Router ──────────────────────────────────────────────────────────────────

const modelConfigsRouter = router({
  list: publicProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ input }) => listModelConfigs(input.tenantId)),

  availableModels: publicProcedure.query(() => AVAILABLE_MODELS),

  save: publicProcedure
    .input(z.object({
      tenantId: z.number(),
      agentName: z.enum(["discovery", "mapping", "generator", "generator_mapper", "extractor"]),
      provider: z.enum(["manus", "openai", "anthropic", "groq", "gemini"]),
      modelId: z.string().min(1).max(100),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().min(64).max(32000).optional(),
      apiKey: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await saveModelConfig({
        tenantId: input.tenantId,
        agentName: input.agentName,
        provider: input.provider,
        modelId: input.modelId,
        temperature: input.temperature?.toFixed(2) ?? "0.10",
        maxTokens: input.maxTokens ?? 2048,
        apiKey: input.apiKey ?? null,
      });
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteModelConfig(input.id);
      return { success: true };
    }),
});

// ─── Invoices Router ──────────────────────────────────────────────────────────

const invoicesRouter = router({
  list: publicProcedure
    .input(z.object({
      tenantId: z.number().optional(),
      source: z.enum(["conta_azul", "omie"]).optional(),
      status: z.enum(["open", "paid", "overdue", "cancelled"]).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => listInvoices(input)),

  stats: publicProcedure
    .input(z.object({ tenantId: z.number().optional() }))
    .query(async ({ input }) => getInvoiceStats(input.tenantId)),

  globalStats: publicProcedure.query(async () => getInvoiceStats()),
});

// ─── Receivables Router ───────────────────────────────────────────────────────

const receivablesRouter = router({
  list: publicProcedure
    .input(z.object({
      tenantId: z.number().optional(),
      source: z.enum(["conta_azul", "omie"]).optional(),
      status: z.enum(["open", "paid", "overdue", "cancelled", "partial"]).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => listReceivables(input)),

  stats: publicProcedure
    .input(z.object({ tenantId: z.number().optional() }))
    .query(async ({ input }) => getReceivableStats(input.tenantId)),

  globalStats: publicProcedure.query(async () => getReceivableStats()),
});

// ─── Payables Router ──────────────────────────────────────────────────────────

const payablesRouter = router({
  list: publicProcedure
    .input(z.object({
      tenantId: z.number().optional(),
      source: z.enum(["conta_azul", "omie"]).optional(),
      status: z.enum(["open", "paid", "overdue", "cancelled", "partial"]).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => listPayables(input)),

  stats: publicProcedure
    .input(z.object({ tenantId: z.number().optional() }))
    .query(async ({ input }) => getPayableStats(input.tenantId)),

  globalStats: publicProcedure.query(async () => getPayableStats()),
});

// ─── Customers Router ─────────────────────────────────────────────────────────

const customersRouter = router({
  list: publicProcedure
    .input(z.object({
      tenantId: z.number().optional(),
      source: z.enum(["conta_azul", "omie"]).optional(),
      status: z.enum(["active", "inactive", "blocked"]).optional(),
      search: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => listCustomers(input)),

  stats: publicProcedure
    .input(z.object({ tenantId: z.number().optional() }))
    .query(async ({ input }) => getCustomerStats(input.tenantId)),

  globalStats: publicProcedure.query(async () => getCustomerStats()),
});

// ─── Logs Router ──────────────────────────────────────────────────────────────

const logsRouter = router({
  list: publicProcedure
    .input(z.object({ tenantId: z.number().optional() }))
    .query(async ({ input }) => listExtractionLogs(input.tenantId)),
});

// ─── App Router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  tenants: tenantsRouter,
  erpConfigs: erpConfigsRouter,
  agents: agentsRouter,
  modelConfigs: modelConfigsRouter,
  invoices: invoicesRouter,
  receivables: receivablesRouter,
  payables: payablesRouter,
  customers: customersRouter,
  logs: logsRouter,
});

export type AppRouter = typeof appRouter;
