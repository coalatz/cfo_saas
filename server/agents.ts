/**
 * CFO SaaS Extraction Agents
 *
 * Pipeline: Discovery → Mapping → Generator → Extractor
 *
 * Entities extracted per ERP:
 *   - invoices       (notas fiscais / vendas)
 *   - receivables    (contas a receber)
 *   - payables       (contas a pagar)
 *   - customers      (clientes / parceiros)
 */

import axios from "axios";
import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";
import { fetchDocumentation } from "./docFetcher";
import {
  createExtractionLog,
  createPipeline,
  getErpConfig,
  updateExtractionLog,
  updatePipeline,
  upsertInvoice,
  upsertReceivable,
  upsertPayable,
  upsertCustomer,
} from "./db";

// ─── ERP Metadata ─────────────────────────────────────────────────────────────

const ERP_META: Record<"conta_azul" | "omie", { name: string; docUrl: string; baseUrl: string }> = {
  conta_azul: {
    name: "Conta Azul",
    docUrl: "https://developers.contaazul.com/",
    baseUrl: "https://api-v2.contaazul.com",
  },
  omie: {
    name: "Omie",
    docUrl: "https://developer.omie.com.br/service-list/",
    baseUrl: "https://app.omie.com.br/api/v1",
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntityType = "invoices" | "receivables" | "payables" | "customers";

export interface PipelineState {
  pipelineId: number;
  tenantId: number;
  erpType: "conta_azul" | "omie";
  credentials: Record<string, string>;
  docUrl?: string;
  discoveryResult?: DiscoveryResult;
  mappingResult?: MappingResult;
  generatorResult?: GeneratorResult;
  extractorResult?: ExtractorResult;
}

export interface DiscoveryResult {
  authType: string;
  baseUrl?: string;
  endpoints: string[];
  paginationParams?: Record<string, string>;
  dateParams?: Record<string, string>;
  description: string;
}

export interface MappingResult {
  dePara: Record<string, string>;
  envelope: string;
  entityMappings: Record<EntityType, {
    dePara: Record<string, string>;
    envelope: string;
  }>;
}

export interface EntityFieldMappings {
  external_id: string[];
  customer_name?: string[];    // receivables, invoices
  supplier_name?: string[];    // payables
  name?: string[];             // customers
  issue_date?: string[];
  due_date?: string[];
  gross_amount?: string[];
  paid_amount?: string[];
  document?: string[];         // customers: CPF/CNPJ
  email?: string[];
  phone?: string[];
  city?: string[];
  state?: string[];
  document_type?: string[];
  document_number?: string[];
  category?: string[];
}

export interface GeneratorResult {
  authStrategy: string;
  paginationStrategy: string;
  dateFilterParams: Record<string, string>;
  envelopeKeys: string[];
  fieldMappings: Record<string, string[]>;
  entityStrategies: Record<EntityType, {
    envelopeKeys: string[];
    fieldMappings: EntityFieldMappings;
  }>;
}

export interface ExtractorResult {
  recordsCount: number;
  byEntity: Record<EntityType, number>;
  sample: Record<string, unknown>[];
}

// ─── Static Knowledge Base ────────────────────────────────────────────────────

const STATIC_DISCOVERY: Record<"conta_azul" | "omie", DiscoveryResult> = {
  conta_azul: {
    authType: "OAuth2 Bearer Token",
    endpoints: [
      "GET /v1/contratos (pagina, tamanho_pagina, data_inicio, data_fim) → invoices",
      "GET /v1/vendas (pagina, tamanho_pagina, data_inicio, data_fim) → invoices",
      "GET /v1/cobrancas (pagina, tamanho_pagina) → receivables",
      "GET /v1/clientes (pagina, tamanho_pagina) → customers",
    ],
    description: "API REST Conta Azul com OAuth2. Paginação via pagina/tamanho_pagina. Envelopes: itens, items ou lista direta.",
  },
  omie: {
    authType: "API Key (app_key + app_secret no body POST)",
    endpoints: [
      "POST /financas/contareceber/ action=ListarTitulosReceber → receivables",
      "POST /financas/contapagar/ action=ListarTitulosPagar → payables",
      "POST /produtos/pedido/ action=ListarPedidos → invoices",
      "POST /geral/clientes/ action=ListarClientes → customers",
    ],
    description: "API REST Omie com app_key/app_secret no body. Paginação via pagina/registros_por_pagina. Envelopes: titulosEncontrados, clientes_cadastro, pedidos.",
  },
};

const STATIC_ENTITY_STRATEGIES: Record<"conta_azul" | "omie", GeneratorResult["entityStrategies"]> = {
  conta_azul: {
    invoices: {
      envelopeKeys: ["itens", "items", "data"],
      fieldMappings: {
        external_id: ["id"],
        customer_name: ["cliente.nome", "nome_cliente", "cliente"],
        issue_date: ["data_inicio", "data_emissao", "data", "created_at"],
        gross_amount: ["valor_total", "total", "valor", "valor_bruto"],
      },
    },
    receivables: {
      envelopeKeys: ["itens", "items", "data"],
      fieldMappings: {
        external_id: ["id"],
        customer_name: ["cliente.nome", "nome_cliente", "cliente"],
        issue_date: ["data_emissao", "data_inicio", "data"],
        due_date: ["data_vencimento", "vencimento", "data_fim"],
        gross_amount: ["valor_total", "total", "valor", "valor_bruto"],
        paid_amount: ["valor_pago", "valor_recebido"],
        document_type: ["tipo_documento", "tipo"],
        document_number: ["numero_documento", "numero", "nosso_numero"],
      },
    },
    payables: {
      envelopeKeys: ["itens", "items", "data"],
      fieldMappings: {
        external_id: ["id"],
        supplier_name: ["fornecedor.nome", "nome_fornecedor", "fornecedor"],
        issue_date: ["data_emissao", "data_inicio", "data"],
        due_date: ["data_vencimento", "vencimento"],
        gross_amount: ["valor_total", "total", "valor"],
        paid_amount: ["valor_pago"],
        document_type: ["tipo_documento", "tipo"],
        document_number: ["numero_documento", "numero"],
        category: ["categoria", "centro_custo"],
      },
    },
    customers: {
      envelopeKeys: ["itens", "items", "data"],
      fieldMappings: {
        external_id: ["id"],
        name: ["nome", "razao_social", "name"],
        document: ["cpf_cnpj", "cnpj", "cpf", "documento"],
        email: ["email"],
        phone: ["telefone", "celular", "fone"],
        city: ["cidade", "municipio"],
        state: ["estado", "uf"],
      },
    },
  },
  omie: {
    invoices: {
      envelopeKeys: ["pedidos", "lista"],
      fieldMappings: {
        external_id: ["nCodPedido", "codigo_pedido"],
        customer_name: ["cNomeParceiro", "razao_social", "nome_fantasia"],
        issue_date: ["dDtEmissao", "data_previsao"],
        gross_amount: ["valor_mercadorias", "nValorTotal", "nValorPedido", "nValorTitulo"],
      },
    },
    receivables: {
      envelopeKeys: ["titulosEncontrados", "lista"],
      fieldMappings: {
        external_id: ["nCodTitulo"],
        customer_name: ["cNomeParceiro", "razao_social"],
        issue_date: ["dDtEmissao"],
        due_date: ["dDtVenc"],
        gross_amount: ["nValorTitulo"],
        paid_amount: ["nValorPago", "nValorRecebido"],
        document_type: ["cTipo"],
        document_number: ["cNumTitulo"],
      },
    },
    payables: {
      envelopeKeys: ["titulosEncontrados", "lista"],
      fieldMappings: {
        external_id: ["nCodTitulo"],
        supplier_name: ["cNomeParceiro", "razao_social"],
        issue_date: ["dDtEmissao"],
        due_date: ["dDtVenc"],
        gross_amount: ["nValorTitulo"],
        paid_amount: ["nValorPago"],
        document_type: ["cTipo"],
        document_number: ["cNumTitulo"],
        category: ["cCategoria"],
      },
    },
    customers: {
      envelopeKeys: ["clientes_cadastro", "lista"],
      fieldMappings: {
        external_id: ["codigo_cliente_omie"],
        name: ["razao_social", "nome_fantasia"],
        document: ["cnpj_cpf"],
        email: ["email"],
        phone: ["telefone1_numero", "telefone2_numero"],
        city: ["cidade"],
        state: ["estado"],
      },
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveNestedField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveFirst(obj: Record<string, unknown>, candidates: string[]): unknown {
  for (const c of candidates) {
    const val = resolveNestedField(obj, c);
    if (val != null && val !== "") return val;
  }
  return null;
}

function normalizeDate(raw: unknown): string {
  if (!raw) return "";
  const str = String(raw);
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0]!;
  const parts = str.split("/");
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]!.padStart(2, "0")}-${parts[0]!.padStart(2, "0")}`;
  }
  return str.substring(0, 10);
}

function normalizeAmount(raw: unknown): string {
  return String(parseFloat(String(raw ?? "0").replace(",", ".")) || 0);
}

function extractItemsFromEnvelope(data: unknown, envelopeKeys: string[]): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of envelopeKeys) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
    for (const val of Object.values(obj)) {
      if (Array.isArray(val) && val.length > 0) return val as Record<string, unknown>[];
    }
  }
  return [];
}

function inferDocumentType(doc: string): "cpf" | "cnpj" | "other" {
  const digits = doc.replace(/\D/g, "");
  if (digits.length === 11) return "cpf";
  if (digits.length === 14) return "cnpj";
  return "other";
}

// ─── Agent 1: Discovery ───────────────────────────────────────────────────────

export async function runDiscoveryAgent(state: PipelineState): Promise<DiscoveryResult> {
  const meta = ERP_META[state.erpType];
  const base = STATIC_DISCOVERY[state.erpType];
  const urlToFetch = state.docUrl || meta.docUrl;

  console.log(`[Discovery] Iniciando scraping de documentação em ${urlToFetch}...`);
  let fetchedDoc;
  try {
    fetchedDoc = await fetchDocumentation(urlToFetch);
  } catch (err) {
    console.warn("[Discovery] DocFetcher falhou, usando estático", err);
  }

  // Se o DocFetcher encontrou OpenAPI, pulamos o LLM!
  if (fetchedDoc?.openapi) {
    console.log(`[Discovery] OpenAPI extraído nativamente para ${state.erpType}. Ignorando LLM!`);
    return {
      authType: fetchedDoc.openapi.authType,
      baseUrl: meta.baseUrl,
      endpoints: fetchedDoc.openapi.endpoints,
      paginationParams: fetchedDoc.openapi.paginationParams,
      dateParams: fetchedDoc.openapi.dateParams,
      description: `Mapeado automaticamente via OpenAPI JSON da documentação ${urlToFetch}`,
    };
  }

  const contextText = fetchedDoc?.combinedText
    ? `Documentação extraída:\n\n${fetchedDoc.combinedText}`
    : `Auth: ${base.authType}\nEndpoints conhecidos: ${base.endpoints.join(" | ")}`;

  try {
    const llmResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Você é um especialista em integração de ERPs brasileiros. Analise a documentação do ERP "${meta.name}" e extraia estritamente as rotas de listagem de faturas, contas a receber/pagar e clientes. Retorne o JSON exigido. Nunca retorne texto solto.`,
        },
        {
          role: "user",
          content: `ERP: ${meta.name}
${contextText}

Extraia authType, endpoints (array com verbos e query params), description, paginationParams e dateParams.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "discovery_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              authType: { type: "string" },
              baseUrl: { type: "string" },
              endpoints: { type: "array", items: { type: "string" } },
              description: { type: "string" },
              paginationParams: { type: "object", additionalProperties: { type: "string" } },
              dateParams: { type: "object", additionalProperties: { type: "string" } },
            },
            required: ["authType", "baseUrl", "endpoints", "description"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = llmResponse.choices?.[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
      return {
        authType: parsed.authType || base.authType,
        baseUrl: parsed.baseUrl || meta.baseUrl,
        endpoints: parsed.endpoints?.length ? parsed.endpoints : base.endpoints,
        paginationParams: parsed.paginationParams,
        dateParams: parsed.dateParams,
        description: parsed.description || base.description,
      };
    }
  } catch (err) {
    console.warn("[Discovery] LLM enrichment failed, using base knowledge:", err);
  }

  return base;
}

// ─── Agent 2: Mapping ─────────────────────────────────────────────────────────

export async function runMappingAgent(state: PipelineState): Promise<MappingResult> {
  const { erpType, discoveryResult } = state;

  const staticEntityMappings: MappingResult["entityMappings"] = {
    invoices: {
      dePara: STATIC_ENTITY_STRATEGIES[erpType].invoices.fieldMappings as unknown as Record<string, string>,
      envelope: STATIC_ENTITY_STRATEGIES[erpType].invoices.envelopeKeys[0] ?? "itens",
    },
    receivables: {
      dePara: STATIC_ENTITY_STRATEGIES[erpType].receivables.fieldMappings as unknown as Record<string, string>,
      envelope: STATIC_ENTITY_STRATEGIES[erpType].receivables.envelopeKeys[0] ?? "titulosEncontrados",
    },
    payables: {
      dePara: STATIC_ENTITY_STRATEGIES[erpType].payables.fieldMappings as unknown as Record<string, string>,
      envelope: STATIC_ENTITY_STRATEGIES[erpType].payables.envelopeKeys[0] ?? "titulosEncontrados",
    },
    customers: {
      dePara: STATIC_ENTITY_STRATEGIES[erpType].customers.fieldMappings as unknown as Record<string, string>,
      envelope: STATIC_ENTITY_STRATEGIES[erpType].customers.envelopeKeys[0] ?? "clientes_cadastro",
    },
  };

  // Aggregate de-para for LLM context
  const allDePara: Record<string, string> = {};
  for (const em of Object.values(staticEntityMappings)) {
    Object.assign(allDePara, em.dePara);
  }

  try {
    const llmResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Especialista em mapeamento de dados ERP para modelo canônico financeiro com 4 entidades: invoices, receivables, payables, customers.`,
        },
        {
          role: "user",
          content: `ERP: ${erpType}
Endpoints: ${discoveryResult?.endpoints?.join(" | ")}
Mapeamento base: ${JSON.stringify(allDePara).substring(0, 500)}

Enriqueça o mapeamento. Retorne JSON com: dePara (campo_erp→campo_canonico), envelope (chave principal).`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "mapping_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              dePara: { type: "object", additionalProperties: { type: "string" } },
              envelope: { type: "string" },
            },
            required: ["dePara", "envelope"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = llmResponse.choices?.[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
      return {
        dePara: { ...parsed.dePara, ...allDePara },
        envelope: parsed.envelope || staticEntityMappings.invoices.envelope,
        entityMappings: staticEntityMappings,
      };
    }
  } catch (err) {
    console.warn("[Mapping] LLM failed, using static mapping:", err);
  }

  return {
    dePara: allDePara,
    envelope: staticEntityMappings.invoices.envelope,
    entityMappings: staticEntityMappings,
  };
}

// ─── Agent 3: Generator ───────────────────────────────────────────────────────

export async function runGeneratorAgent(state: PipelineState): Promise<GeneratorResult> {
  const { erpType, discoveryResult } = state;

  const staticBase: Omit<GeneratorResult, "entityStrategies"> = erpType === "conta_azul"
    ? {
      authStrategy: "bearer_token",
      paginationStrategy: "page_size",
      dateFilterParams: { data_inicio: "2020-01-01", data_fim: "2030-12-31" },
      envelopeKeys: ["itens", "items", "data"],
      fieldMappings: {
        external_id: ["id"],
        customer_name: ["cliente.nome", "nome_cliente"],
        issue_date: ["data_emissao", "data_inicio", "data"],
        gross_amount: ["valor_total", "total", "valor"],
      },
    }
    : {
      authStrategy: "api_key_body",
      paginationStrategy: "page_records",
      dateFilterParams: { dDtEmissaoIni: "01/01/2020", dDtEmissaoFim: "31/12/2030" },
      envelopeKeys: ["titulosEncontrados", "clientes_cadastro", "pedidos", "lista"],
      fieldMappings: {
        external_id: ["nCodTitulo", "nCodPedido", "codigo_cliente_omie"],
        customer_name: ["cNomeParceiro", "razao_social"],
        issue_date: ["dDtEmissao"],
        gross_amount: ["nValorTitulo", "valor_mercadorias"],
      },
    };

  try {
    const llmResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Arquiteto de conectores ERP. Gere estratégia de extração para 4 entidades: invoices, receivables, payables, customers.`,
        },
        {
          role: "user",
          content: `ERP: ${erpType}
Auth: ${discoveryResult?.authType}
Endpoints: ${discoveryResult?.endpoints?.slice(0, 4).join(" | ")}

Retorne JSON com: authStrategy, paginationStrategy, dateFilterParams, envelopeKeys, fieldMappings (external_id, customer_name, issue_date, gross_amount como arrays).`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "generator_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              authStrategy: { type: "string" },
              paginationStrategy: { type: "string" },
              dateFilterParams: { type: "object", additionalProperties: { type: "string" } },
              envelopeKeys: { type: "array", items: { type: "string" } },
              fieldMappings: {
                type: "object",
                properties: {
                  external_id: { type: "array", items: { type: "string" } },
                  customer_name: { type: "array", items: { type: "string" } },
                  issue_date: { type: "array", items: { type: "string" } },
                  gross_amount: { type: "array", items: { type: "string" } },
                },
                required: ["external_id", "customer_name", "issue_date", "gross_amount"],
                additionalProperties: false,
              },
            },
            required: ["authStrategy", "paginationStrategy", "dateFilterParams", "envelopeKeys", "fieldMappings"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = llmResponse.choices?.[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
      return {
        authStrategy: parsed.authStrategy || staticBase.authStrategy,
        paginationStrategy: parsed.paginationStrategy || staticBase.paginationStrategy,
        dateFilterParams: {
          ...staticBase.dateFilterParams,
          ...(discoveryResult?.dateParams || {}),
          ...parsed.dateFilterParams
        },
        envelopeKeys: Array.from(new Set([...staticBase.envelopeKeys, ...(parsed.envelopeKeys || [])])),
        fieldMappings: {
          external_id: Array.from(new Set([...(parsed.fieldMappings?.external_id || []), ...staticBase.fieldMappings.external_id])),
          customer_name: Array.from(new Set([...(parsed.fieldMappings?.customer_name || []), ...staticBase.fieldMappings.customer_name])),
          issue_date: Array.from(new Set([...(parsed.fieldMappings?.issue_date || []), ...staticBase.fieldMappings.issue_date])),
          gross_amount: Array.from(new Set([...(parsed.fieldMappings?.gross_amount || []), ...staticBase.fieldMappings.gross_amount])),
        },
        entityStrategies: STATIC_ENTITY_STRATEGIES[erpType],
      };
    }
  } catch (err) {
    console.warn("[Generator] LLM failed, using static generator:", err);
  }

  return { ...staticBase, entityStrategies: STATIC_ENTITY_STRATEGIES[erpType] };
}

// ─── Agent 4: Extractor ───────────────────────────────────────────────────────

async function extractContaAzulEntity(
  credentials: Record<string, string>,
  entityType: EntityType,
  generatorResult: GeneratorResult,
  onBatch: (items: Record<string, unknown>[]) => Promise<void>
): Promise<number> {
  const baseUrl = credentials.base_url || "https://api-v2.contaazul.com";
  const token = credentials.token || credentials.access_token;
  if (!token) throw new Error("Conta Azul: token não fornecido");

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const entityEndpoints: Record<EntityType, string[]> = {
    invoices: ["/v1/contratos", "/v1/vendas"],
    receivables: ["/v1/cobrancas"],
    payables: ["/v1/pagamentos"],
    customers: ["/v1/clientes"],
  };

  const strategy = generatorResult.entityStrategies[entityType];
  const endpoints = entityEndpoints[entityType];
  let totalRecords = 0;

  for (const endpoint of endpoints) {
    let page = 1;
    const pageSize = 100;
    while (true) {
      try {
        const params: Record<string, unknown> = {
          ...(generatorResult.dateFilterParams?.page ? { [generatorResult.dateFilterParams.page]: page } : { pagina: page }),
          ...(generatorResult.dateFilterParams?.size ? { [generatorResult.dateFilterParams.size]: pageSize } : { tamanho_pagina: pageSize }),
          ...(entityType !== "customers" ? generatorResult.dateFilterParams : {}),
        };
        const response = await axios.get(`${baseUrl}${endpoint}`, { headers, params, timeout: 30000 });
        const items = extractItemsFromEnvelope(response.data, strategy.envelopeKeys);
        if (items.length === 0) break;
        await onBatch(items);
        totalRecords += items.length;
        if (items.length < pageSize) break;
        page++;
      } catch (err: any) {
        if ([401, 403, 404].includes(err?.response?.status)) break;
        throw err;
      }
    }
  }
  return totalRecords;
}

async function extractOmieEntity(
  credentials: Record<string, string>,
  entityType: EntityType,
  generatorResult: GeneratorResult,
  onBatch: (items: Record<string, unknown>[]) => Promise<void>
): Promise<number> {
  const baseUrl = "https://app.omie.com.br/api/v1";
  const { app_key, app_secret } = credentials;
  if (!app_key || !app_secret) throw new Error("Omie: app_key e app_secret são obrigatórios");

  const entityEndpoints: Record<EntityType, { path: string; action: string; envelope: string }[]> = {
    invoices: [{ path: "/produtos/pedido/", action: "ListarPedidos", envelope: "pedidos" }],
    receivables: [{ path: "/financas/contareceber/", action: "ListarTitulosReceber", envelope: "titulosEncontrados" }],
    payables: [{ path: "/financas/contapagar/", action: "ListarTitulosPagar", envelope: "titulosEncontrados" }],
    customers: [{ path: "/geral/clientes/", action: "ListarClientes", envelope: "clientes_cadastro" }],
  };

  const strategy = generatorResult.entityStrategies[entityType];
  const endpoints = entityEndpoints[entityType];
  let totalRecords = 0;

  for (const ep of endpoints) {
    let page = 1;
    const pageSize = 50;
    while (true) {
      try {
        const paramBlock: Record<string, unknown> = {
          pagina: page,
          registros_por_pagina: pageSize,
          apenas_importado_api: "N",
          ...(entityType !== "customers" ? generatorResult.dateFilterParams : {}),
        };
        const body = { call: ep.action, app_key, app_secret, param: [paramBlock] };
        const response = await axios.post(`${baseUrl}${ep.path}`, body, {
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
        });
        const items = extractItemsFromEnvelope(response.data, [ep.envelope, ...strategy.envelopeKeys]);
        if (items.length === 0) break;
        await onBatch(items);
        totalRecords += items.length;
        if (items.length < pageSize) break;
        page++;
      } catch (err: any) {
        if ([500, 404].includes(err?.response?.status)) break;
        throw err;
      }
    }
  }
  return totalRecords;
}

export async function runExtractorAgent(state: PipelineState): Promise<ExtractorResult> {
  const { tenantId, erpType, credentials, generatorResult, pipelineId } = state;
  if (!generatorResult) throw new Error("Generator result required");

  const entities: EntityType[] = ["invoices", "receivables", "payables", "customers"];
  const byEntity: Record<EntityType, number> = { invoices: 0, receivables: 0, payables: 0, customers: 0 };
  const sample: Record<string, unknown>[] = [];
  let totalRecords = 0;
  let totalFailed = 0;

  for (const entityType of entities) {
    const logId = await createExtractionLog({
      tenantId,
      pipelineId,
      erpType,
      entityType,
      status: "running",
      recordsProcessed: 0,
      recordsFailed: 0,
      metadata: { entityType, pipelineId },
    });

    let entityRecords = 0;
    let entityFailed = 0;
    const strategy = generatorResult.entityStrategies[entityType];

    const processBatch = async (items: Record<string, unknown>[]) => {
      for (const raw of items) {
        try {
          const fm = strategy.fieldMappings;
          const externalId = String(resolveFirst(raw, fm.external_id ?? []) ?? `gen-${Date.now()}-${Math.random()}`);
          const issueDate = normalizeDate(resolveFirst(raw, fm.issue_date ?? []));
          const dueDate = fm.due_date ? normalizeDate(resolveFirst(raw, fm.due_date)) : undefined;
          const grossAmount = normalizeAmount(resolveFirst(raw, fm.gross_amount ?? []));
          const paidAmount = fm.paid_amount ? normalizeAmount(resolveFirst(raw, fm.paid_amount)) : undefined;

          // Upload raw to S3
          const rawKey = `tenants/${tenantId}/${erpType}/${entityType}/${externalId}.json`;
          let storageKey = rawKey;
          try {
            const { key } = await storagePut(rawKey, JSON.stringify(raw), "application/json");
            storageKey = key;
          } catch { /* best-effort */ }

          if (entityType === "invoices") {
            const customerName = String(resolveFirst(raw, fm.customer_name ?? []) ?? "N/A");
            await upsertInvoice({ tenantId, source: erpType, externalId, customerName, issueDate: issueDate || undefined, grossAmount, rawStorageKey: storageKey, status: "open" });

          } else if (entityType === "receivables") {
            const customerName = String(resolveFirst(raw, fm.customer_name ?? []) ?? "N/A");
            await upsertReceivable({ tenantId, source: erpType, externalId, customerName, issueDate: issueDate || undefined, dueDate: dueDate || undefined, grossAmount, paidAmount: paidAmount || undefined, documentType: String(resolveFirst(raw, fm.document_type ?? []) ?? ""), documentNumber: String(resolveFirst(raw, fm.document_number ?? []) ?? ""), status: "open", rawStorageKey: storageKey });

          } else if (entityType === "payables") {
            const supplierName = String(resolveFirst(raw, fm.supplier_name ?? []) ?? "N/A");
            await upsertPayable({ tenantId, source: erpType, externalId, supplierName, issueDate: issueDate || undefined, dueDate: dueDate || undefined, grossAmount, paidAmount: paidAmount || undefined, documentType: String(resolveFirst(raw, fm.document_type ?? []) ?? ""), documentNumber: String(resolveFirst(raw, fm.document_number ?? []) ?? ""), category: String(resolveFirst(raw, fm.category ?? []) ?? ""), status: "open", rawStorageKey: storageKey });

          } else if (entityType === "customers") {
            const name = String(resolveFirst(raw, fm.name ?? []) ?? "N/A");
            const document = String(resolveFirst(raw, fm.document ?? []) ?? "");
            const documentType = document ? inferDocumentType(document) : undefined;
            await upsertCustomer({ tenantId, source: erpType, externalId, name, document: document || undefined, documentType, email: String(resolveFirst(raw, fm.email ?? []) ?? "") || undefined, phone: String(resolveFirst(raw, fm.phone ?? []) ?? "") || undefined, city: String(resolveFirst(raw, fm.city ?? []) ?? "") || undefined, state: String(resolveFirst(raw, fm.state ?? []) ?? "") || undefined, status: "active", rawStorageKey: storageKey });
          }

          if (sample.length < 3) sample.push({ entityType, externalId, raw });
          entityRecords++;
          totalRecords++;
        } catch (err) {
          entityFailed++;
          totalFailed++;
          console.error(`[Extractor] Failed ${entityType} item:`, err);
        }
      }
      await updateExtractionLog(logId, { recordsProcessed: entityRecords, recordsFailed: entityFailed });
    };

    try {
      if (erpType === "conta_azul") {
        await extractContaAzulEntity(credentials, entityType, generatorResult, processBatch);
      } else {
        await extractOmieEntity(credentials, entityType, generatorResult, processBatch);
      }
      await updateExtractionLog(logId, {
        status: entityFailed > 0 && entityRecords === 0 ? "failed" : entityFailed > 0 ? "partial" : "success",
        recordsProcessed: entityRecords,
        recordsFailed: entityFailed,
        finishedAt: new Date(),
      });
    } catch (err: any) {
      await updateExtractionLog(logId, {
        status: "failed",
        errorMessage: err?.message || String(err),
        recordsProcessed: entityRecords,
        finishedAt: new Date(),
      });
      console.warn(`[Extractor] Entity ${entityType} failed:`, err?.message);
    }

    byEntity[entityType] = entityRecords;
  }

  return { recordsCount: totalRecords, byEntity, sample };
}

// ─── Pipeline Orchestrator ────────────────────────────────────────────────────

export async function runFullPipeline(
  tenantId: number,
  erpType: "conta_azul" | "omie"
): Promise<{ pipelineId: number; success: boolean; error?: string }> {
  const erpConfig = await getErpConfig(tenantId, erpType);
  if (!erpConfig) throw new Error(`ERP config not found for tenant ${tenantId} / ${erpType}`);

  const credentials = erpConfig.credentials as Record<string, string>;
  const pipelineId = await createPipeline({ tenantId, erpType, status: "running", currentStep: "discovery" });
  const state: PipelineState = { pipelineId, tenantId, erpType, credentials, docUrl: erpConfig.docUrl ?? undefined };

  try {
    await updatePipeline(pipelineId, { currentStep: "discovery", status: "running" });
    state.discoveryResult = await runDiscoveryAgent(state);
    await updatePipeline(pipelineId, { discoveryResult: state.discoveryResult as any, currentStep: "mapping" });

    state.mappingResult = await runMappingAgent(state);
    await updatePipeline(pipelineId, { mappingResult: state.mappingResult as any, currentStep: "generator" });

    state.generatorResult = await runGeneratorAgent(state);
    await updatePipeline(pipelineId, { generatorResult: state.generatorResult as any, currentStep: "extractor" });

    state.extractorResult = await runExtractorAgent(state);
    await updatePipeline(pipelineId, {
      extractorResult: state.extractorResult as any,
      currentStep: "done",
      status: "completed",
      finishedAt: new Date(),
    });

    return { pipelineId, success: true };
  } catch (err: any) {
    await updatePipeline(pipelineId, { status: "failed", errorMessage: err?.message || String(err), finishedAt: new Date() });
    return { pipelineId, success: false, error: err?.message || String(err) };
  }
}
