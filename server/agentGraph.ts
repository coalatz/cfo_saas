/**
 * CFO SaaS — LangGraph Agent Pipeline (generalista)
 *
 * Filosofia: você passa (erpName, docUrl, credentials).
 * Zero hardcode. Zero if/else por ERP. Tudo gerado pelos agentes.
 *
 * Fluxo:
 *   discovery → mapping → generator → extractor → END
 *
 * Discovery  — lê a doc real da URL, extrai auth/endpoints/paginação
 * Mapping    — identifica qual endpoint serve cada entidade e mapeia campos
 * Generator  — gera JavaScript puro (auth.js, extractor.js, mapper.js)
 *              e salva em connectors/<erpName>/
 * Extractor  — faz require() dos arquivos gerados e executa
 *              nenhuma lógica de ERP aqui, só orquestra e persiste
 */

import { StateGraph, Annotation, END } from "@langchain/langgraph";
import axios from "axios";
import * as fs from "fs";
import * as cheerio from "cheerio";
import * as path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { fetchDocumentation, fetchPage, extractUsefulContent } from "./docFetcher";
import { invokeLLMJson, invokeLLMText, DEFAULT_MODEL_CONFIGS, ModelConfig } from "./llmFactory";
import {
  createExtractionLog,
  createPipeline,
  getErpConfig,
  getModelConfig,
  updateExtractionLog,
  updatePipeline,
  upsertCustomer,
  upsertInvoice,
  upsertPayable,
  upsertReceivable,
} from "./db";
import { storagePut } from "./storage";

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type EntityType = "invoices" | "receivables" | "payables" | "customers";

export interface EndpointInfo {
  method: "GET" | "POST";
  path: string;
  description: string;
  queryParams?: string[];
  bodyParams?: string[];
  action?: string; // para ERPs estilo RPC (ex: Omie "ListarClientes")
}

export interface DiscoveryResult {
  authType: string;        // descrição livre: "OAuth2 Bearer", "API Key in body", etc.
  authFields?: string[];
  baseUrl: string;
  endpoints: EndpointInfo[];
  paginationStrategy: string;
  paginationParams: Record<string, string>; // ex: { pageParam: "pagina", sizeParam: "tamanho_pagina" }
  paginationTermination?: string;
  dateParams: Record<string, string>;       // ex: { startParam: "data_inicio", endParam: "data_fim" }
  responseEnvelopes: string[];              // chaves JSON que contêm os arrays
  isRpcStyle?: boolean;
  description: string;
  docSource: "live" | "cache" | "fallback";
  docUrl: string;
  rawDocText: string; // texto bruto — passado para os próximos agentes
  // Exemplos extraídos do crawl seletivo — envelope e primeiro objeto real por entidade
  entityExamples?: Record<string, { envelope: string; responseExample: string }>;
}

export interface MappingResult {
  // Para cada entidade: qual endpoint usar + como mapear campos
  entityMappings: Record<EntityType, {
    endpoint: EndpointInfo;
    envelope: string;                     // chave JSON que contém o array na resposta
    dePara: Record<string, string[]>;     // canonical_field → [erp_field1, erp_field2, ...]
  }>;
}

export interface GeneratorResult {
  // Caminhos dos arquivos JS gerados em disco
  connectorDir: string;   // ex: "connectors/conta_azul"
  authFile: string;       // ex: "connectors/conta_azul/auth.js"
  extractorFile: string;
  mapperFile: string;
}

export interface NormalizedRecord {
  externalId: string;
  entityType: EntityType;
  customerName?: string;
  supplierName?: string;
  name?: string;
  issueDate?: string;
  dueDate?: string;
  grossAmount: string;
  paidAmount?: string;
  document?: string;
  documentType?: "cpf" | "cnpj" | "other";
  documentNumber?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  category?: string;
}

export interface ExtractorResult {
  recordsCount: number;
  byEntity: Record<EntityType, number>;
  sample: Array<{ entity: EntityType; externalId: string; raw: unknown }>;
}

// ─── Estado do grafo ───────────────────────────────────────────────────────────

const PipelineStateAnnotation = Annotation.Root({
  pipelineId: Annotation<number>(),
  tenantId: Annotation<number>(),
  erpName: Annotation<string>(),     // qualquer string — "conta_azul", "omie", "totvs", etc.
  credentials: Annotation<Record<string, string>>(),
  docUrl: Annotation<string>(),
  modelConfigs: Annotation<Record<string, ModelConfig>>(),

  discoveryResult: Annotation<DiscoveryResult | undefined>(),
  mappingResult: Annotation<MappingResult | undefined>(),
  generatorResult: Annotation<GeneratorResult | undefined>(),
  extractorResult: Annotation<ExtractorResult | undefined>(),
  error: Annotation<string | undefined>(),
  retryCount: Annotation<number>({ reducer: (x, y) => y ?? x, default: () => 0 }),
  lastCodeError: Annotation<string | undefined>(),
});

type PipelineState = typeof PipelineStateAnnotation.State;

// ─── Node 1: Discovery ─────────────────────────────────────────────────────────
// Única responsabilidade: ler a doc da URL e extrair estrutura da API

async function discoveryNode(state: PipelineState): Promise<Partial<PipelineState>> {
  const { erpName, docUrl, modelConfigs, pipelineId } = state;
  const config = modelConfigs.discovery ?? DEFAULT_MODEL_CONFIGS.discovery!;

  await updatePipeline(pipelineId, { currentStep: "discovery", status: "running" });

  let rawDocText = "";
  let docSource: DiscoveryResult["docSource"] = "fallback";

  // ── Passo 1: Tenta OpenAPI/Swagger — zero LLM se funcionar ──────────────────
  try {
    const resHTML = await axios.get(docUrl, { timeout: 15000 });
    const $ = cheerio.load(resHTML.data);

    // Busca link para spec JSON na página
    let jsonUrl = "";
    $("a, link").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href && (href.endsWith(".json") || href.includes("swagger") || href.includes("openapi"))) {
        jsonUrl = href.startsWith("http") ? href : new URL(href, docUrl).toString();
      }
    });

    // Tenta também URLs canônicas de OpenAPI
    if (!jsonUrl) {
      const candidates = [
        new URL("/openapi.json", docUrl).toString(),
        new URL("/swagger.json", docUrl).toString(),
        new URL("/api-docs", docUrl).toString(),
        new URL("/v2/api-docs", docUrl).toString(),
      ];
      for (const candidate of candidates) {
        try {
          const probe = await axios.get(candidate, { timeout: 5000 });
          if (probe.data?.paths || probe.data?.swagger || probe.data?.openapi) {
            jsonUrl = candidate;
            break;
          }
        } catch { /* não existe, tenta próximo */ }
      }
    }

    if (jsonUrl) {
      console.log(`[Discovery] OpenAPI encontrado: ${jsonUrl}`);
      const specRes = await axios.get(jsonUrl, { timeout: 15000 });
      const spec = specRes.data;

      if (spec?.paths) {
        // Extrai endpoints como EndpointInfo[]
        const endpoints: EndpointInfo[] = [];
        for (const [p_path, p_methods] of Object.entries<any>(spec.paths)) {
          for (const method of ["get", "post", "put", "patch"] as const) {
            if (!p_methods[method]) continue;
            const op = p_methods[method];
            const queryParams = (op.parameters || [])
              .filter((p: any) => p.in === "query")
              .map((p: any) => p.name);
            const bodyParams = op.requestBody
              ? Object.keys(op.requestBody?.content?.["application/json"]?.schema?.properties || {})
              : [];
            endpoints.push({
              method: method.toUpperCase() as "GET" | "POST",
              path: p_path,
              description: op.summary || op.description || p_path,
              queryParams,
              bodyParams,
            });
          }
        }

        // Extrai auth
        const secSchemes = spec.components?.securitySchemes || {};
        const firstScheme = Object.values<any>(secSchemes)[0];
        let authType = "Bearer Token in Authorization header";
        let authFields = ["access_token"];
        if (firstScheme?.type === "apiKey") {
          authType = `API Key in ${firstScheme.in} as "${firstScheme.name}"`;
          authFields = [firstScheme.name];
        } else if (firstScheme?.type === "oauth2") {
          authType = "OAuth2 Bearer Token in Authorization header";
          authFields = ["access_token"];
        } else if (firstScheme?.type === "http" && firstScheme?.scheme === "basic") {
          authType = "HTTP Basic Auth: username and password as Base64 in Authorization header";
          authFields = ["username", "password"];
        }

        const baseUrl = spec.servers?.[0]?.url || docUrl;

        const discoveryResult: DiscoveryResult = {
          authType,
          authFields,
          baseUrl,
          endpoints,
          paginationStrategy: "page and size query params",
          paginationParams: { pageParam: "page", sizeParam: "size", defaultPageSize: "50" } as any,
          paginationTermination: "stop when response array length is 0 or less than page size",
          dateParams: {},
          responseEnvelopes: ["data", "items", "results"],
          isRpcStyle: false,
          description: spec.info?.description || spec.info?.title || erpName,
          docSource: "live",
          docUrl,
          rawDocText: JSON.stringify(spec).slice(0, 4000),
        };

        await updatePipeline(pipelineId, { discoveryResult: discoveryResult as any, currentStep: "mapping" });
        console.log(`[Discovery] OpenAPI ✅ — ${endpoints.length} endpoints, sem LLM`);
        return { discoveryResult };
      }
    }
  } catch (err) {
    console.warn("[Discovery] OpenAPI não encontrado, usando LLM:", (err as any).message);
  }

  // ── Passo 0: Extração de Sementes da Raiz (Fase 1) ──────────────────────────
  let seedUrls: string[] = [docUrl];
  try {
    const { fetchRootHtml, extractLinksWithText } = await import("./docFetcher.js");
    const rootHtml = await fetchRootHtml(docUrl);
    const links = extractLinksWithText(rootHtml, docUrl);
    
    if (links.length > 0) {
      const sampleLinks = links.slice(0, 200);
      const filteredUrls = await invokeLLMJson<string[]>(
        config,
        `You are an API documentation architect.`,
        `The ERP system is "${erpName}".
We need to find the API endpoints for: invoices, receivables, payables, customers, orders, and billing.
Here is a JSON list of links found on the documentation root page:
${JSON.stringify(sampleLinks)}

Return a JSON array of up to 10 URLs (href values) from this list that are the MOST LIKELY entry points for those modules.
Return ONLY a valid JSON array of strings, no explanation.`
      );
      if (Array.isArray(filteredUrls) && filteredUrls.length > 0) {
        seedUrls = filteredUrls;
        console.log(`[Discovery] Sementes escolhidas pelo LLM para ${erpName}:`, seedUrls);
      }
    }
  } catch (err) {
    console.warn("[Discovery] Falha na Fase 1 (extração de sementes), usando raiz como fallback:", (err as any).message);
  }

  // ── Passo 1: Crawl seletivo com intenção (Fase 2) ──────────────────────────
  // Itera pelos seedUrls um a um, pergunta ao LLM se cada página cobre
  // endpoints LIST/GET das 4 entidades, e para assim que encontrar todas.
  const neededEntities = ["invoices", "receivables", "payables", "customers"];
  const foundEntities = new Set<string>();
  const usefulPages: string[] = [];
  // Exemplos extraídos da doc por entidade — repassados ao Mapping como fonte da verdade
  const entityExamples: Record<string, { envelope: string; responseExample: string }> = {};

  try {
    // ── Tentativa rápida de OpenAPI nas seedUrls antes do crawl ────────────────
    for (const url of seedUrls) {
      try {
        const probe = await axios.get(url, { timeout: 8000, headers: { Accept: "application/json" } });
        const spec = probe.data;
        if (typeof spec === "object" && spec?.paths) {
          console.log(`[Discovery] OpenAPI detectado em seedUrl: ${url}`);
          const endpoints: EndpointInfo[] = [];
          for (const [p_path, p_methods] of Object.entries<any>(spec.paths)) {
            for (const method of ["get", "post"] as const) {
              if (!p_methods[method]) continue;
              const op = p_methods[method];
              endpoints.push({
                method: method.toUpperCase() as "GET" | "POST",
                path: p_path,
                description: op.summary || op.description || p_path,
                queryParams: (op.parameters || []).filter((p: any) => p.in === "query").map((p: any) => p.name),
                bodyParams: op.requestBody ? Object.keys(op.requestBody?.content?.["application/json"]?.schema?.properties || {}) : [],
              });
            }
          }
          const secSchemes = spec.components?.securitySchemes || {};
          const firstScheme = Object.values<any>(secSchemes)[0];
          let authType = "Bearer Token in Authorization header";
          let authFields = ["access_token"];
          if (firstScheme?.type === "apiKey") {
            authType = `API Key in ${firstScheme.in} as "${firstScheme.name}"`;
            authFields = [firstScheme.name];
          } else if (firstScheme?.type === "oauth2") {
            authType = "OAuth2 Bearer Token in Authorization header";
          } else if (firstScheme?.type === "http" && firstScheme?.scheme === "basic") {
            authType = "HTTP Basic Auth";
            authFields = ["username", "password"];
          }
          const discoveryResult: DiscoveryResult = {
            authType, authFields,
            baseUrl: spec.servers?.[0]?.url || docUrl,
            endpoints,
            paginationStrategy: "page and size query params",
            paginationParams: { pageParam: "page", sizeParam: "size", defaultPageSize: "50" } as any,
            paginationTermination: "stop when response array length is 0 or less than page size",
            dateParams: {},
            responseEnvelopes: ["data", "items", "results"],
            isRpcStyle: false,
            description: spec.info?.description || spec.info?.title || erpName,
            docSource: "live", docUrl,
            rawDocText: JSON.stringify(spec).slice(0, 4000),
          };
          await updatePipeline(pipelineId, { discoveryResult: discoveryResult as any, currentStep: "mapping" });
          console.log(`[Discovery] OpenAPI via seedUrl ✅ — ${endpoints.length} endpoints, sem crawl adicional`);
          return { discoveryResult };
        }
      } catch { /* não é JSON/OpenAPI, continua */ }
    }

    for (const url of seedUrls) {
      if (foundEntities.size === neededEntities.length) {
        console.log(`[Discovery] Todas as ${neededEntities.length} entidades encontradas. Parando crawl.`);
        break;
      }

      let pageContent = "";
      try {
        const pageResult = await fetchPage(url);
        if (!pageResult) continue;
        pageContent = extractUsefulContent(pageResult.html);
        if (pageContent.length < 50) continue; // página sem conteúdo útil
      } catch (fetchErr: any) {
        console.warn(`[Discovery] Falha ao buscar ${url}: ${fetchErr?.message}`);
        continue;
      }

      try {
        const remaining = neededEntities.filter(e => !foundEntities.has(e));
        const verdict = await invokeLLMJson<{
          useful: boolean;
          covers: string[];
          envelope?: string;
          responseExample?: string;
        }>(
          config,
          `You are an API documentation analyst. Answer ONLY with valid JSON.`,
          `Does this documentation page contain a LIST or GET endpoint (for reading data in bulk) for any of these entities: ${remaining.join(", ")}?

If yes, fill all fields. If no, return { "useful": false, "covers": [] }.

Return format:
{
  "useful": true,
  "covers": ["entity"],
  "envelope": "exact JSON key in the response that holds the records array (e.g. conta_receber_cadastro, clientes_cadastro, data, items)",
  "responseExample": "copy the first object from the response array shown in the docs, as a JSON string — or empty string if not visible"
}

CRITICAL: The "covers" array MUST only contain values from this exact list:
["invoices", "receivables", "payables", "customers"]
Never use endpoint names, Portuguese terms, or any other values.
Mapping rules:
- notas de entrada, notas fiscais, sales orders → "invoices"
- contas a receber, accounts receivable → "receivables"
- contas a pagar, accounts payable → "payables"
- clientes, customers, clients → "customers"

For the "envelope": look carefully for the JSON key name of the array in response examples shown in the documentation.
For the "responseExample": copy the first record object from any response example shown in the docs.

Page URL: ${url}
Page content (extracted):
${pageContent.slice(0, 3000)}`
        );

        // Sanitização defensiva: filtra qualquer valor fora da lista canônica
        const VALID_ENTITIES = new Set(["invoices", "receivables", "payables", "customers"]);
        const validCovers = (verdict.covers ?? []).filter(e => VALID_ENTITIES.has(e));

        if (verdict.useful && validCovers.length > 0) {
          usefulPages.push(`### Source: ${url}\n\n${pageContent}`);
          validCovers.forEach(e => {
            foundEntities.add(e);
            // Salva envelope e responseExample por entidade — fonte da verdade para o Mapping
            if (!entityExamples[e]) {
              entityExamples[e] = {
                envelope: verdict.envelope ?? "",
                responseExample: verdict.responseExample ?? "",
              };
            }
          });
          console.log(`[Discovery] ✅ ${url} — cobre: ${validCovers.join(", ")} | envelope: ${verdict.envelope ?? "(não extraído)"} (${foundEntities.size}/${neededEntities.length})`);
        } else {
          if (verdict.useful && (verdict.covers ?? []).length > 0 && validCovers.length === 0) {
            console.warn(`[Discovery] ⚠️ LLM retornou covers inválidos: [${verdict.covers.join(", ")}] para ${url} — ignorando`);
          }
          console.log(`[Discovery] ❌ ${url} — não cobre entidades pendentes`);
        }
      } catch (llmErr: any) {
        console.warn(`[Discovery] LLM verdict falhou para ${url}: ${llmErr?.message}`);
        // Em caso de falha do LLM, inclui a página por precaução
        usefulPages.push(`### Source: ${url}\n\n${pageContent}`);
      }
    }

    // Log de entidades não cobertas (pipeline continua normalmente)
    const faltando = neededEntities.filter(e => !foundEntities.has(e));
    if (faltando.length > 0) {
      console.warn(`[Discovery] Finalizou crawl sem cobrir: ${faltando.join(", ")}`);
    }

    if (usefulPages.length > 0) {
      rawDocText = usefulPages.join("\n\n---\n\n");
      docSource = "live";
      console.log(`[Discovery] Crawl seletivo: ${usefulPages.length} páginas úteis, ${rawDocText.length} chars, entidades: [${Array.from(foundEntities).join(", ")}]`);
    } else {
      // Fallback: se nenhuma página foi marcada como útil, tenta o crawl tradicional
      console.log(`[Discovery] Nenhuma página selecionada pelo LLM. Usando crawl tradicional como fallback...`);
      const fetched = await fetchDocumentation(docUrl, seedUrls);
      if (fetched.combinedText?.length > 200) {
        rawDocText = fetched.combinedText;
        docSource = fetched.source as DiscoveryResult["docSource"];
        console.log(`[Discovery] Fallback: ${fetched.pages.length} páginas — ${rawDocText.length} chars`);
      }
    }
  } catch (err) {
    console.warn("[Discovery] Crawl seletivo falhou, tentando fetchDocumentation:", err);
    try {
      const fetched = await fetchDocumentation(docUrl, seedUrls);
      if (fetched.combinedText?.length > 200) {
        rawDocText = fetched.combinedText;
        docSource = fetched.source as DiscoveryResult["docSource"];
      }
    } catch (innerErr) {
      console.warn("[Discovery] fetchDocumentation também falhou:", innerErr);
    }
  }

  // ── Passo 3: LLM — só chega aqui se OpenAPI não existia ─────────────────────
  console.log(`[Discovery] Invocando LLM para ${erpName}...`);

  const systemPrompt = `You are a senior API integration engineer specialized in ERP systems.

Your job is to read raw API documentation and extract a precise, structured description of the API.

Rules:
- If the documentation is an index/overview without technical details, use your pre-trained knowledge about this ERP to fill in the correct endpoints, HTTP methods, and auth strategy.
- For auth, describe EXACTLY what credentials are needed and WHERE they go. Be specific.
- For pagination, describe EXACTLY how to detect the END of data (e.g. "stop when array length < page_size").
- If this is an RPC-style API, set method to POST and include the action field.
- ONLY extract endpoints that READ or LIST data in bulk (e.g., "ListarClientes", "Search Invoices", "Get All Payables"). 
- DO NOT extract endpoints that CREATE, UPDATE, or DELETE data.
- DO NOT extract single-item lookup endpoints (e.g., "ConsultarCliente por ID", "Get Invoice by ID") unless it's the only option. We need to sync massive amounts of data, so pagination list endpoints are strictly required.
- VERY IMPORTANT: Do not assume all endpoints are at the root path '/'. Read the 'Source: [URL]' headers or documentation text for each module to extract the EXACT path relative to the baseUrl.
- Return ONLY valid JSON, no markdown, no explanation.`;

  const userPrompt = `ERP system: "${erpName}"
Documentation URL: ${docUrl}

RAW DOCUMENTATION:
${rawDocText || "(fetch failed — use your pre-trained knowledge about this ERP)"}

Return this exact JSON:
{
  "authType": "full description: method name + exactly which fields + exactly where they go (e.g. 'POST body as JSON with fields...' or 'Authorization: Bearer {access_token} header'). Do not invent schemas, extract exactly what the documentation specifies.",
  "authFields": ["exact credential field names needed, e.g. app_key, app_secret, access_token, client_id"],
  "baseUrl": "https://...",
  "endpoints": [
    {
      "method": "GET or POST",
      "path": "/path/to/endpoint",
      "description": "which entity this returns",
      "queryParams": ["param1"],
      "bodyParams": ["param1"],
      "action": "RPC action name if applicable (e.g. ListarClientes)"
    }
  ],
  "paginationStrategy": "exact description of how to paginate",
  "paginationParams": {
    "pageParam": "exact param name for page number",
    "sizeParam": "exact param name for page size",
    "defaultPageSize": 50
  },
  "paginationTermination": "EXACT condition to stop: e.g. 'stop when response array length is 0', 'stop when total_de_registros equals 0', 'stop when next_cursor is null'",
  "dateParams": {
    "startParam": "exact param name",
    "endParam": "exact param name",
    "dateFormat": "YYYY-MM-DD or DD/MM/YYYY or timestamp"
  },
  "responseEnvelopes": ["exact JSON keys that contain the records array, e.g. clientes_cadastro, data, items"],
  "isRpcStyle": false,
  "description": "1-2 sentence summary"
}`;

  try {
    const result = await invokeLLMJson<Omit<DiscoveryResult, "docSource" | "docUrl" | "rawDocText">>(
      config, systemPrompt, userPrompt
    );

    const discoveryResult: DiscoveryResult = {
      authType: result.authType || "unknown",
      authFields: result.authFields || [],
      baseUrl: result.baseUrl || docUrl,
      endpoints: Array.isArray(result.endpoints) ? result.endpoints : [],
      paginationStrategy: result.paginationStrategy || "",
      paginationParams: result.paginationParams || {},
      paginationTermination: result.paginationTermination || "response array length is 0",
      dateParams: result.dateParams || {},
      responseEnvelopes: result.responseEnvelopes || [],
      isRpcStyle: result.isRpcStyle || false,
      description: result.description || "",
      docSource,
      docUrl,
      rawDocText,
      entityExamples,  // exemplos extraídos do crawl por entidade
    };

    await updatePipeline(pipelineId, { discoveryResult: discoveryResult as any });
    console.log(`[Discovery] OK — auth: ${discoveryResult.authType} | endpoints: ${discoveryResult.endpoints.length}`);
    console.log(`[Discovery] entityExamples a enviar:`, JSON.stringify(entityExamples));
    return { discoveryResult };
  } catch (err: any) {
    console.error("[Discovery] LLM falhou:", err.message);
    return {
      discoveryResult: {
        authType: "unknown", authFields: [], baseUrl: docUrl, endpoints: [],
        paginationStrategy: "", paginationParams: {}, paginationTermination: "stop when array is empty",
        dateParams: {}, responseEnvelopes: [], isRpcStyle: false,
        description: "discovery failed", docSource: "fallback", docUrl, rawDocText,
      },
    };
  }
}

// ─── Node 2: Mapping ───────────────────────────────────────────────────────────
// Única responsabilidade: para cada entidade canônica, qual endpoint + campos

async function mappingNode(state: PipelineState): Promise<Partial<PipelineState>> {
  const { erpName, discoveryResult, modelConfigs, pipelineId } = state;
  const config = modelConfigs.mapping ?? DEFAULT_MODEL_CONFIGS.mapping!;

  await updatePipeline(pipelineId, { currentStep: "mapping" });

  // DEBUG: confirma se entityExamples chegou do Discovery
  console.log("[Mapping] entityExamples recebidos:", JSON.stringify(discoveryResult?.entityExamples ?? null));
  console.log("[Mapping] discoveryResult keys:", Object.keys(discoveryResult ?? {}).join(", "));

  const systemPrompt = `You are a data mapping specialist for ERP integrations.

Given API discovery results, map each of our 4 canonical entities to the correct endpoint and field names from THIS specific API.

Canonical entities:
- invoices: sales orders, notas fiscais, contratos, vendas emitidas
- receivables: accounts receivable, contas a receber, títulos a receber
- payables: accounts payable, contas a pagar, títulos a pagar
- customers: clients, clientes, parceiros, pessoas

Rules:
- Use dot notation for nested fields (e.g. "cliente.razao_social")
- List ALL possible field name variations this ERP might use
- If the entity doesn't exist in this ERP, still include it with the closest alternative endpoint
- The envelope is the exact JSON key that contains the records array in the response
- Return ONLY valid JSON, no markdown

CRITICAL RULE — ENTITY EXAMPLES ARE THE SOURCE OF TRUTH:
If ENTITY EXAMPLES are provided below, you MUST use them to determine:
1. The exact envelope key (use it exactly as given — do not alter it)
2. The exact field names for dePara:
   a. If responseExample is provided: use ONLY field names visible in that JSON object. Do not invent names.
   b. If responseExample is "(not available)": the envelope key is still correct — search the DOCUMENTATION EXCERPT below for any mention of that envelope key and extract the field names listed near it. Use those exact field names in dePara.
Do NOT leave dePara arrays empty. Always populate them with real field names from the documentation.`;

  const buildExamplesText = (): string => {
    const ex = discoveryResult?.entityExamples;
    if (!ex || Object.keys(ex).length === 0) return "";
    const lines = Object.entries(ex).map(([entity, data]) => {
      const hasExample = data.responseExample && data.responseExample.trim().length > 2;
      const exLine = hasExample
        ? `  responseExample: ${data.responseExample}`
        : `  responseExample: (not available) — FALLBACK: find "${data.envelope}" in the DOCUMENTATION EXCERPT and extract ALL field names from that array. Populate dePara with those exact field names. Do NOT return empty arrays.`;
      return `${entity}:\n  envelope: "${data.envelope}"\n${exLine}`;
    });
    return `\n\nENTITY EXAMPLES (SOURCE OF TRUTH — use these ABOVE any other heuristic):\n${lines.join("\n")}\n`;
  };
  const examplesText = buildExamplesText();

  const userPrompt = `ERP: "${erpName}"
Auth type: ${discoveryResult?.authType}
Auth fields: ${discoveryResult?.authFields?.join(", ")}
Base URL: ${discoveryResult?.baseUrl}
Is RPC style: ${discoveryResult?.isRpcStyle}
Pagination termination: ${discoveryResult?.paginationTermination}
${examplesText}
Available endpoints:
${discoveryResult?.endpoints?.map(e =>
    `  ${e.method} ${e.path}${e.action ? ` action="${e.action}"` : ""} — ${e.description}`
  ).join("\n")}

DOCUMENTATION EXCERPT:
${discoveryResult?.rawDocText?.slice(0, 5000)}

Return this JSON:
{
  "entityMappings": {
    "invoices": {
      "endpoint": { "method": "GET|POST", "path": "...", "action": "...", "queryParams": [], "bodyParams": [] },
      "envelope": "exact key in response that holds the array",
      "dePara": {
        "external_id":   ["field1", "field2"],
        "customer_name": ["field1", "nested.field"],
        "issue_date":    ["field1"],
        "gross_amount":  ["field1"]
      }
    },
    "receivables": {
      "endpoint": { "method": "...", "path": "...", "action": "...", "queryParams": [], "bodyParams": [] },
      "envelope": "...",
      "dePara": {
        "external_id":     ["..."],
        "customer_name":   ["..."],
        "issue_date":      ["..."],
        "due_date":        ["..."],
        "gross_amount":    ["..."],
        "paid_amount":     ["..."],
        "document_type":   ["..."],
        "document_number": ["..."]
      }
    },
    "payables": {
      "endpoint": { "method": "...", "path": "...", "action": "...", "queryParams": [], "bodyParams": [] },
      "envelope": "...",
      "dePara": {
        "external_id":     ["..."],
        "supplier_name":   ["..."],
        "issue_date":      ["..."],
        "due_date":        ["..."],
        "gross_amount":    ["..."],
        "paid_amount":     ["..."],
        "document_type":   ["..."],
        "document_number": ["..."],
        "category":        ["..."]
      }
    },
    "customers": {
      "endpoint": { "method": "...", "path": "...", "action": "...", "queryParams": [], "bodyParams": [] },
      "envelope": "...",
      "dePara": {
        "external_id": ["..."],
        "name":        ["..."],
        "document":    ["..."],
        "email":       ["..."],
        "phone":       ["..."],
        "city":        ["..."],
        "state":       ["..."]
      }
    }
  }
}`;

  try {
    const result = await invokeLLMJson<{ entityMappings: MappingResult["entityMappings"] }>(
      config, systemPrompt, userPrompt
    );
    const mappingResult: MappingResult = { entityMappings: result.entityMappings };
    await updatePipeline(pipelineId, { mappingResult: mappingResult as any });
    console.log(`[Mapping] OK — entidades: ${Object.keys(mappingResult.entityMappings).join(", ")}`);
    return { mappingResult };
  } catch (err: any) {
    console.error("[Mapping] LLM falhou:", err.message);
    return { mappingResult: undefined };
  }
}

// ─── Node 3: Generator ─────────────────────────────────────────────────────────
async function generatorNode(state: PipelineState): Promise<Partial<PipelineState>> {
  const { erpName, credentials, discoveryResult, mappingResult, modelConfigs, pipelineId } = state;
  const config = modelConfigs.generator ?? DEFAULT_MODEL_CONFIGS.generator!;
  const mapperConfig = DEFAULT_MODEL_CONFIGS.generator_mapper!;

  await updatePipeline(pipelineId, { currentStep: "generator", status: "running" });

  const connectorDir = path.resolve("connectors", erpName);
  fs.mkdirSync(connectorDir, { recursive: true });

  const errorPrefix = state.lastCodeError 
    ? `\nCRITICAL: Your previous code failed to execute with this error:\n${state.lastCodeError}\nRewrite the code to fix this issue!\n\n`
    : "";

  // ── auth.js ──────────────────────────────────────────────────────────────────
  const authSystemPrompt = `You are a senior JavaScript developer generating connector code for ERP integrations.

Generate a single self-contained CommonJS module. No imports at the top level.

Rules for auth:
- Study the authType description carefully — it tells you EXACTLY where credentials go
- If credentials go in the request BODY (like Omie's app_key/app_secret), return them from getAuthBody()
- If credentials go in a HEADER (like Bearer Token), return them from getAuthHeaders()
- If credentials go in QUERY PARAMS, return them from getAuthQueryParams()
- All three functions must always be exported, returning {} when not applicable
- Use snake_case for all credential property access (e.g. credentials.access_token, credentials.app_key)
- Do NOT use the crypto module
- Do NOT add conditional logic — assume credentials always has the needed fields
- Return ONLY raw JavaScript code, no markdown fences, no explanation

CRITICAL: Study the request examples from the documentation carefully.
Your getAuthBody must return an object that matches EXACTLY the structure of those request examples — same field names, same nesting, same array structures. Do not invent or simplify the structure.
If the request example shows a 'param' array containing an object, getAuthBody MUST return that 'param' array.
If the request example shows flat fields, return flat fields.
The request example in the documentation is the absolute source of truth for the body structure.`;

  const authUserPrompt = `${errorPrefix}Generate auth.js for ERP "${erpName}".

Auth description: ${discoveryResult?.authType}
Required credential fields: ${discoveryResult?.authFields?.join(", ")}
Base URL: ${discoveryResult?.baseUrl}

DOCUMENTATION EXCERPT (look for request examples that show the exact body structure):
${discoveryResult?.rawDocText?.slice(0, 3000)}

Generate module.exports = { getAuthHeaders, getAuthBody, getAuthQueryParams }

Examples of correct implementations:

// Bearer Token in header:
function getAuthHeaders(credentials) {
  return { "Authorization": "Bearer " + credentials.access_token };
}
function getAuthBody(credentials, action) { return {}; }
function getAuthQueryParams(credentials) { return {}; }

// API Key + Secret in POST body (Omie-style RPC) — note 'call' and 'param' array from request example:
function getAuthHeaders(credentials) { return { "Content-Type": "application/json" }; }
function getAuthBody(credentials, action) {
  // EXACTLY matches the structure shown in the Omie request example
  return { app_key: credentials.app_key, app_secret: credentials.app_secret, call: action, param: [{}] };
}
function getAuthQueryParams(credentials) { return {}; }

// API Key in query param:
function getAuthHeaders(credentials) { return {}; }
function getAuthBody(credentials, action) { return {}; }
function getAuthQueryParams(credentials) { return { api_key: credentials.api_key }; }`;

  // ── extractor.js ─────────────────────────────────────────────────────────────
  const extractorSystemPrompt = `You are a senior JavaScript developer generating connector code for ERP integrations.

Generate a single self-contained CommonJS module.
Only allowed requires: require('axios'), require('./auth')

Rules:
- ALWAYS call auth.getAuthHeaders(credentials), auth.getAuthBody(credentials, action), auth.getAuthQueryParams(credentials) — never hardcode credentials
- Merge authBody into the axios data payload
- Merge authQueryParams into axios params
- Handle pagination in a while loop with a max of 100 iterations as safety cap
- Use the EXACT paginationTermination condition provided — do not invent your own stop condition
- When merging pagination parameters into the request body, you MUST dynamically detect if authBody has a property that is an array containing an object (e.g., \`{ param: [{}] }\`). If it does, inject the pagination keys into that first object. If 'Is RPC style' is true, NEVER write flat assignments like \`data.pagina = pagina\`.
- ANY other extra body parameters (like date filters or custom flags discovered in the docs) MUST ALSO be injected into that EXACT SAME nested object. NUNCA coloque no nível raiz se for RPC style.
- For boolean-like string flags discovered in ERP docs, default to 'N' or 'S' (or omit them) if you are unsure of the exact format, as many legacy ERPs reject native boolean types.
- Wrap every axios call in try/catch with exponential backoff retry (3 attempts: wait 2s, 4s, 8s) for status 429, 503, and network errors
- VERY IMPORTANT: Many legacy ERPs return HTTP 500 or 404 when a page has no records (e.g. "No records found"). If you receive a 500 or 404 error during the request, do NOT throw an error. Treat it as an empty page (end of pagination), break the loop, and return the accumulated records.
- Extract the records array using the envelope key. CRITICAL FALLBACK: If the exact envelope key is not found in response.data, dynamically search the response.data object for ANY property that is an Array and use that as the records array. If there are multiple arrays, use the one with the most items.
- IMPORTANT: After extracting records from response.data, check if response.data has a numeric property named like "total_de_registros", "totalRegistros", "total_records", or similar with value === 0. If found and equals 0, it means there is no data at all — break the loop immediately and return the accumulated records.
- IMPORTANT: After extracting records from response.data, check if response.data has an array property that looks like an error list (objects containing "CODIGO" and "MENSAGEM" keys, or "code" and "message" keys, or "faultstring"). If found, it means the ERP returned HTTP 200 but with an error payload — treat it as an empty page, break the loop, and return the accumulated records. Do NOT throw an error.
- ALWAYS add 'timeout: 30000' to every axios call — never leave the pipeline hanging on a slow API response
- Return ONLY raw JavaScript code, no markdown fences`;

  const extractorUserPrompt = `${errorPrefix}Generate extractor.js for ERP "${erpName}".

Auth: ${discoveryResult?.authType}
Base URL: ${discoveryResult?.baseUrl}
Is RPC style: ${discoveryResult?.isRpcStyle}
Pagination strategy: ${discoveryResult?.paginationStrategy}
Pagination params: ${JSON.stringify(discoveryResult?.paginationParams)}
EXACT stop condition: ${discoveryResult?.paginationTermination}
Date params: ${JSON.stringify(discoveryResult?.dateParams)}

ENTITY MAPPING:
${JSON.stringify(mappingResult?.entityMappings, null, 2)}

CRITICAL: The function signature MUST be:
  async function extractRawData(credentials, entity, baseUrl, maxPages = 100) {
It MUST be declared with the "async" keyword because it uses await inside.

Export: module.exports = { extractRawData }

The function must:
1. Look up the endpoint and envelope from the mapping above for the given entity
2. Loop with pagination using the exact stop condition above
3. Break the loop if the page number exceeds maxPages (e.g. if (page > maxPages) break;)
4. Accumulate all records across pages into a single array
5. Return the full array`;

  // ── mapper.js ────────────────────────────────────────────────────────────────
  const mapperSystemPrompt = `You are a senior JavaScript developer generating connector code for ERP integrations.

Generate a single self-contained CommonJS module.

Rules:
- The normalize function receives a raw record object and an entity name
- Use the dePara mappings to find values — try each candidate field in order, return the first non-null non-empty value
- Support dot notation traversal for nested fields (e.g. "cliente.razao_social")
- For dates: handle DD/MM/YYYY, YYYY-MM-DD, and ISO timestamps — always output YYYY-MM-DD
- For amounts: handle both "1234.56" and "1.234,56" formats — always output a numeric string
- Return ONLY raw JavaScript code, no markdown fences`;

  const mapperUserPrompt = `${errorPrefix}Generate mapper.js for ERP "${erpName}".

MAPPINGS:
${JSON.stringify(mappingResult?.entityMappings, null, 2)}

Export: normalize(raw, entity)
module.exports = { normalize }`;

  try {
    // ── FASE 1: Gerar Auth e Extractor ──────────────────────────────────────────
    const [authRawText, extractorRawText] = await Promise.all([
      invokeLLMText(config, authSystemPrompt, authUserPrompt),
      invokeLLMText(config, extractorSystemPrompt, extractorUserPrompt),
    ]);

    const clean = (code: string) => code
      .replace(/^\s*```javascript\n?/gim, "")
      .replace(/^\s*```js\n?/gim, "")
      .replace(/^\s*```\n?/gim, "")
      .replace(/```\s*$/gim, "")
      .trim();

    const authFile = path.join(connectorDir, "auth.js");
    const extractorFile = path.join(connectorDir, "extractor.js");
    const mapperFile = path.join(connectorDir, "mapper.js");

    fs.writeFileSync(authFile, clean(authRawText), "utf-8");

    // ── Post-processing determinístico do extractor.js ──────────────────────
    // O LLM pode gerar erros difíceis de detectar via prompt:
    //   1. Esquecer o "async" na função
    //   2. Usar envelope errado (inventar sufixo como "Array", "List", etc.)
    //   3. Omitir timeout no axios
    // Corrigimos programaticamente antes de gravar — sem tocar no conteúdo semântico.
    let extractorCode = clean(extractorRawText);

    // 1. Garante "async function extractRawData"
    extractorCode = extractorCode.replace(
      /^(function extractRawData)/m,
      "async function extractRawData"
    );

    // 2. Corrige envelopes: substitui qualquer valor de envelope no código
    //    pelo valor exato do mappingResult (case-sensitive, palavra completa)
    if (mappingResult?.entityMappings) {
      for (const [, em] of Object.entries(mappingResult.entityMappings)) {
        const correctEnvelope = em.envelope;
        if (!correctEnvelope) continue;
        // Substitui strings próximas ao envelope correto (com possível sufixo/prefixo inventado pelo LLM)
        // Regex: a string entre aspas que começa com o envelope correto mas pode ter sufixo extra
        const envPattern = new RegExp(
          `["'](${correctEnvelope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[A-Za-z0-9_]*)["']`,
          "g"
        );
        extractorCode = extractorCode.replace(envPattern, `"${correctEnvelope}"`);
      }
    }

    // 3. Adiciona timeout: 30000 em chamadas axios que não tenham timeout
    extractorCode = extractorCode.replace(
      /(await\s+axios\s*\(\s*\{[\s\S]*?)(}\s*\))/g,
      (match, inner, closing) => {
        if (inner.includes("timeout")) return match;
        return `${inner.trimEnd()},\n            timeout: 30000,  // evita travamento em API lenta\n          ${closing}`;
      }
    );
    fs.writeFileSync(extractorFile, extractorCode, "utf-8");

    // ── FASE 1.5: Executar Teste Real para Capturar Ground Truth ──────────────
    console.log(`[Generator] Arquivos Fase 1 salvos. Iniciando extração teste para o Mapper...`);
    const rawExamples: Record<string, unknown> = {};
    try {
      delete require.cache[require.resolve(extractorFile)];
      delete require.cache[require.resolve(authFile)];
      const { extractRawData } = require(extractorFile);
      
      const entities = ["invoices", "receivables", "payables", "customers"];
      for (const entity of entities) {
        try {
          // Passamos maxPages = 1 para capturar apenas a primeira página rápido
          const data = await extractRawData(credentials, entity, discoveryResult?.baseUrl || "", 1);
          if (Array.isArray(data) && data.length > 0) {
            rawExamples[entity] = data[0]; // Guarda o primeiro registro como Ground Truth
            console.log(`[Generator] Amostra real capturada para ${entity}`);
          }
        } catch (e: any) {
          console.warn(`[Generator] Teste de extração falhou para ${entity}:`, e.message);
        }
      }
    } catch (e: any) {
      console.warn(`[Generator] Falha ao carregar extractor para teste:`, e.message);
    }

    // ── FASE 2: Gerar Mapper usando Ground Truth ──────────────────────────────
    const mapperSystemPrompt = `You are a senior JavaScript developer generating connector code for ERP integrations.

Generate a single self-contained CommonJS module.

Rules:
- The normalize function receives a raw record object and an entity name
- Use the provided REAL JSON EXAMPLES as your absolute Ground Truth to write the mapping logic.
- Look exactly at the keys present in the real JSON example to extract data.
- CRITICAL: The returned object MUST use camelCase keys EXACTLY matching what the database expects: externalId, customerName, supplierName, name, issueDate, dueDate, grossAmount, paidAmount, document, documentType, documentNumber, email, phone, city, state, category.
- Support dot notation traversal for nested fields (e.g. "cliente.razao_social")
- For dates: handle DD/MM/YYYY, YYYY-MM-DD, and ISO timestamps — always output YYYY-MM-DD
- For amounts: handle both "1234.56" and "1.234,56" formats — always output a numeric string
- Return ONLY raw JavaScript code, no markdown fences`;

    const mapperUserPrompt = `${errorPrefix}Generate mapper.js for ERP "${erpName}".

REAL JSON EXAMPLES EXTRACTED DIRECTLY FROM THE ERP (GROUND TRUTH):
${JSON.stringify(rawExamples, null, 2)}

(If an entity is missing from the examples above, fall back to the endpoints mapping below)
FALLBACK MAPPINGS:
${JSON.stringify(mappingResult?.entityMappings, null, 2)}

Export: normalize(raw, entity)
module.exports = { normalize }`;

    const mapperRawText = await invokeLLMText(mapperConfig, mapperSystemPrompt, mapperUserPrompt);
    fs.writeFileSync(mapperFile, clean(mapperRawText), "utf-8");

    fs.writeFileSync(
      path.join(connectorDir, "context.json"),
      JSON.stringify({ erpName, discovery: state.discoveryResult, mapping: state.mappingResult }, null, 2),
      "utf-8"
    );

    // ── Validação genérica do auth.js gerado ─────────────────────────────────
    // Carrega o módulo e verifica se ao menos um dos três métodos retorna algo não-vazio.
    // Um cenário onde todos retornam {} significa que o LLM não entendeu onde as credenciais vão.
    try {
      delete require.cache[require.resolve(authFile)];
      const authModule = require(authFile);
      const testBody   = authModule.getAuthBody?.({}, "test") ?? {};
      const testHeaders = authModule.getAuthHeaders?.({}) ?? {};
      const testParams  = authModule.getAuthQueryParams?.({}) ?? {};
      const bodyKeys   = Object.keys(testBody).filter(k => k !== "undefined");
      const headerKeys = Object.keys(testHeaders);
      const paramKeys  = Object.keys(testParams);
      const allEmpty   = bodyKeys.length === 0 && headerKeys.length === 0 && paramKeys.length === 0;

      if (allEmpty) {
        const validationError =
          `auth.js inválido: getAuthBody/getAuthHeaders/getAuthQueryParams todos retornam {}.\n` +
          `ERP: ${erpName} | authType: ${discoveryResult?.authType}\n` +
          `O LLM deve colocar as credenciais em pelo menos um desses métodos conforme a documentação.`;
        console.warn(`[Generator] ⚠️ Validação auth.js FALHOU — todos os métodos retornam {}.`);
        if (state.retryCount < 3) {
          return {
            retryCount: state.retryCount + 1,
            lastCodeError: validationError,
          };
        }
        // Após 3 tentativas, continua mesmo assim para não travar o pipeline
        console.warn(`[Generator] Continuando após ${state.retryCount} tentativas sem auth válido.`);
      } else {
        console.log(`[Generator] ✅ Validação auth.js OK — body:[${bodyKeys.join(",")}] headers:[${headerKeys.join(",")}] params:[${paramKeys.join(",")}]`);
      }
    } catch (validErr: any) {
      console.warn(`[Generator] Erro ao validar auth.js: ${validErr.message}`);
      if (state.retryCount < 3) {
        return {
          retryCount: state.retryCount + 1,
          lastCodeError: `auth.js falhou ao ser carregado: ${validErr.stack || validErr.message}`,
        };
      }
    }

    console.log(`[Generator] OK — arquivos em ${connectorDir}/`);

    const generatorResult: GeneratorResult = { connectorDir, authFile, extractorFile, mapperFile };
    await updatePipeline(pipelineId, { generatorResult: generatorResult as any });
    return { generatorResult };
  } catch (err: any) {
    console.error("[Generator] Falhou:", err.message);
    return { error: `Generator falhou: ${err.message}` };
  }
}

// ─── Node 4: Extractor ─────────────────────────────────────────────────────────
// Única responsabilidade: require() dos arquivos gerados, executar, persistir
// Zero lógica de ERP aqui. Se os arquivos gerados funcionam, isso funciona.

async function extractorNode(state: PipelineState): Promise<Partial<PipelineState>> {
  const { tenantId, erpName, credentials, generatorResult, mappingResult, discoveryResult, pipelineId } = state;

  if (!generatorResult) {
    const errorMsg = state.error || "Generator não rodou";
    await updatePipeline(pipelineId, { status: "failed", errorMessage: errorMsg });
    return { error: errorMsg };
  }

  await updatePipeline(pipelineId, { currentStep: "extractor" });

  const baseUrl = discoveryResult?.baseUrl || credentials.base_url || "";

  // Carrega os módulos gerados do disco
  // Invalida o cache do require para sempre pegar a versão mais recente
  let extractRawData: (creds: Record<string, string>, entity: EntityType, baseUrl: string, discoveryResult: any) => Promise<Record<string, unknown>[]>;
  let normalize: (raw: Record<string, unknown>, entity: EntityType) => Record<string, unknown>;

  try {
    delete require.cache[require.resolve(generatorResult.extractorFile)];
    delete require.cache[require.resolve(generatorResult.authFile)];
    delete require.cache[require.resolve(generatorResult.mapperFile)];

    const extractorModule = require(generatorResult.extractorFile);
    const mapperModule = require(generatorResult.mapperFile);

    extractRawData = extractorModule.extractRawData;
    normalize = mapperModule.normalize;

    if (typeof extractRawData !== "function") throw new Error("extractRawData não exportado");
    if (typeof normalize !== "function") throw new Error("normalize não exportado");
    } catch (err: any) {
      console.error("[Extractor] Falha ao carregar módulos gerados:", err.message);
      
      // Self-healing loop: volta pro generator se < 3 retentativas
      if (state.retryCount < 3) {
        console.log(`[Extractor] Iniciando Self-Healing. Tentativa ${state.retryCount + 1}/3...`);
        return { 
          retryCount: state.retryCount + 1,
          lastCodeError: err.stack || err.message
        };
      }

      await updatePipeline(pipelineId, { status: "failed", errorMessage: err.message });
      return { error: err.message };
    }

    const entities: EntityType[] = ["invoices", "receivables", "payables", "customers"];
    const byEntity: Record<EntityType, number> = { invoices: 0, receivables: 0, payables: 0, customers: 0 };
    const sample: ExtractorResult["sample"] = [];
    let totalRecords = 0;

    for (const entityType of entities) {
      const logId = await createExtractionLog({
        tenantId, pipelineId,
        erpType: erpName as any,
        entityType,
        status: "running",
        recordsProcessed: 0,
        recordsFailed: 0,
        metadata: { entityType, pipelineId },
      });

      let entityRecords = 0;
      let entityFailed = 0;

      let rawItems: Record<string, unknown>[] = [];
      try {
        console.log(`[Extractor] Extraindo ${entityType}...`);
        rawItems = await extractRawData(credentials, entityType, baseUrl, 100);
        console.log(`[Extractor] ${entityType}: ${rawItems.length} registros brutos`);
      } catch (extractErr: any) {
        const msg = extractErr.message || '';
        if (msg.includes('500') || msg.includes('404')) {
          console.log(`[Extractor] ${entityType}: Retornou 500/404. Assumindo lista vazia.`);
          rawItems = [];
        } else {
          throw extractErr;
        }
      }

      try {
        for (const raw of rawItems) {
        try {
          // Normaliza via mapper gerado
          let normalized: Record<string, unknown>;
          try {
            normalized = normalize(raw, entityType);
          } catch {
            // Fallback: usa o mappingResult diretamente caso o mapper gerado falhe
            normalized = fallbackNormalize(raw, entityType, mappingResult);
          }
          // externalId: usa o valor normalizado ou gera um ID único estável baseado no conteúdo do raw
          // Isso garante que o UNIQUE(tenantId, source, externalId) nunca receba string vazia
          const rawExternalId = String(normalized.externalId || "").trim();
          const externalId = rawExternalId
            ? rawExternalId
            : `gen-${Buffer.from(JSON.stringify(raw)).toString("base64").slice(0, 32)}`;
          normalized.externalId = externalId; // propaga de volta para persistRecord usar

          // Persiste raw no storage (pula se Forge não estiver configurado externamente)
          const rawKey = `tenants/${tenantId}/${erpName}/${entityType}/${externalId}.json`;
          let storageKey = rawKey;
          const forgeUrl = process.env.BUILT_IN_FORGE_API_URL ?? "";
          const forgeConfigured = forgeUrl && !forgeUrl.includes("localhost") && !forgeUrl.includes("127.0.0.1");
          if (forgeConfigured) {
            try {
              const { key } = await storagePut(rawKey, JSON.stringify(raw), "application/json");
              storageKey = key;
            } catch { /* best effort */ }
          }

          // Persiste no banco usando as funções canônicas
          await persistRecord(normalized, entityType, tenantId, erpName, storageKey);

          if (sample.length < 5) sample.push({ entity: entityType, externalId, raw });
          entityRecords++;
          totalRecords++;
        } catch (itemErr: any) {
          entityFailed++;
          console.error(`[Extractor] Item ${entityType} falhou:`, itemErr.message);
        }
      }

      await updateExtractionLog(logId, {
        status: entityFailed > 0 && entityRecords === 0 ? "failed"
          : entityFailed > 0 ? "partial"
            : "success",
        recordsProcessed: entityRecords,
        recordsFailed: entityFailed,
        finishedAt: new Date(),
      });
    } catch (entityErr: any) {
      console.error(`[Extractor] Entidade ${entityType} falhou:`, entityErr.message);
      await updateExtractionLog(logId, {
        status: "failed",
        errorMessage: entityErr.message,
        recordsProcessed: entityRecords,
        finishedAt: new Date(),
      });
      
      // Self-healing loop on runtime execution error
      if (state.retryCount < 3) {
        console.log(`[Extractor] Falha em execução de ${entityType}. Iniciando Self-Healing. Tentativa ${state.retryCount + 1}/3...`);
        return { 
          retryCount: state.retryCount + 1,
          lastCodeError: `Error extracting ${entityType}: ${entityErr.stack || entityErr.message}`
        };
      }
    }

    byEntity[entityType] = entityRecords;
  }

  const extractorResult: ExtractorResult = { recordsCount: totalRecords, byEntity, sample };
  console.log(`\n[Extractor] 🎯 EXTRAÇÃO FINALIZADA COM SUCESSO!`);
  console.log(`[Extractor] Total de registros salvos no banco: ${totalRecords}`);
  
  await updatePipeline(pipelineId, {
    extractorResult: extractorResult as any,
    currentStep: "done",
    status: "completed",
    finishedAt: new Date(),
  });

  return { extractorResult };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Normalização de fallback usando o mappingResult — caso o mapper.js gerado falhe */
function fallbackNormalize(
  raw: Record<string, unknown>,
  entity: EntityType,
  mappingResult: MappingResult | undefined
): Record<string, unknown> {
  const dePara = mappingResult?.entityMappings?.[entity]?.dePara ?? {};

  const pick = (candidates: string[] = []): string => {
    for (const c of candidates) {
      const val = c.split(".").reduce((o: any, k) => o?.[k], raw);
      if (val != null && val !== "") return String(val);
    }
    return "";
  };

  const date = (v: string): string | undefined => {
    if (!v) return undefined;
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    const p = v.split("/");
    if (p.length === 3) return `${p[2]}-${p[1]!.padStart(2, "0")}-${p[0]!.padStart(2, "0")}`;
    return v.substring(0, 10);
  };

  const amount = (v: string) => String(parseFloat(v.replace(",", ".")) || 0);

  return {
    externalId: pick(dePara.external_id),
    customerName: pick(dePara.customer_name),
    supplierName: pick(dePara.supplier_name),
    name: pick(dePara.name),
    issueDate: date(pick(dePara.issue_date)),
    dueDate: date(pick(dePara.due_date)),
    grossAmount: amount(pick(dePara.gross_amount)),
    paidAmount: pick(dePara.paid_amount) ? amount(pick(dePara.paid_amount)) : undefined,
    document: pick(dePara.document),
    documentType: pick(dePara.document_type),
    documentNumber: pick(dePara.document_number),
    email: pick(dePara.email),
    phone: pick(dePara.phone),
    city: pick(dePara.city),
    state: pick(dePara.state),
    category: pick(dePara.category),
  };
}

/** Persiste um registro normalizado no banco — mesma lógica independente do ERP */
async function persistRecord(
  n: Record<string, unknown>,
  entity: EntityType,
  tenantId: number,
  source: string,
  rawStorageKey: string
): Promise<void> {
  const externalId = String(n.externalId || "");
  const str = (v: unknown) => v ? String(v) : undefined;
  // Campos com limite fixo de 2 chars — garante que valores longos (nomes mapeados errado) não causem erro no MySQL strict mode
  const code2 = (v: unknown): string | undefined => {
    const s = v ? String(v).trim() : "";
    if (!s) return undefined;
    return s.length <= 2 ? s : undefined; // descarta se não parece código de estado/país
  };

  if (entity === "invoices") {
    await upsertInvoice({
      tenantId, source, externalId,
      customerName: str(n.customerName) ?? "N/A",
      issueDate: str(n.issueDate),
      grossAmount: str(n.grossAmount) ?? "0",
      rawStorageKey, status: "open",
    });
  } else if (entity === "receivables") {
    await upsertReceivable({
      tenantId, source, externalId,
      customerName: str(n.customerName) ?? "N/A",
      issueDate: str(n.issueDate),
      dueDate: str(n.dueDate),
      grossAmount: str(n.grossAmount) ?? "0",
      paidAmount: str(n.paidAmount),
      documentType: str(n.documentType) ?? "",
      documentNumber: str(n.documentNumber) ?? "",
      status: "open", rawStorageKey,
    });
  } else if (entity === "payables") {
    await upsertPayable({
      tenantId, source, externalId,
      supplierName: str(n.supplierName) ?? "N/A",
      issueDate: str(n.issueDate),
      dueDate: str(n.dueDate),
      grossAmount: str(n.grossAmount) ?? "0",
      paidAmount: str(n.paidAmount),
      documentType: str(n.documentType) ?? "",
      documentNumber: str(n.documentNumber) ?? "",
      category: str(n.category) ?? "",
      status: "open", rawStorageKey,
    });
  } else if (entity === "customers") {
    const doc = str(n.document) ?? "";
    const digits = doc.replace(/\D/g, "");
    const docType = digits.length === 11 ? "cpf" : digits.length === 14 ? "cnpj" : undefined;
    await upsertCustomer({
      tenantId, source, externalId,
      name: str(n.name) ?? "N/A",
      tradeName: str(n.tradeName),
      document: doc || undefined,
      documentType: docType as any,
      email: str(n.email),
      phone: str(n.phone),
      city: str(n.city),
      state: code2(n.state),       // VARCHAR(2) — descarta se não for código de 2 letras
      country: code2(n.country),   // VARCHAR(2) — idem
      status: "active", rawStorageKey,
    });
  }
}

// ─── Grafo ─────────────────────────────────────────────────────────────────────

function buildPipelineGraph() {
  return new StateGraph(PipelineStateAnnotation)
    .addNode("discovery", discoveryNode)
    .addNode("mapping", mappingNode)
    .addNode("generator", generatorNode)
    .addNode("extractor", extractorNode)
    .addEdge("__start__", "discovery")
    .addEdge("discovery", "mapping")
    .addEdge("mapping", "generator")
    .addEdge("generator", "extractor")
    .addConditionalEdges("extractor", (state) => {
      // Se não há resultado gerado mas houve increment de retry (teve erro de código),
      // e ainda não estouramos o limite, volta pro generator
      if (state.lastCodeError && state.retryCount > 0 && state.retryCount <= 3) {
        return "generator";
      }
      return END;
    })
    .compile();
}

const pipelineGraph = buildPipelineGraph();

// ─── API pública ───────────────────────────────────────────────────────────────

/**
 * Roda o pipeline completo para qualquer ERP.
 * O ERP config no banco precisa ter: { credentials: {...}, docUrl: "https://..." }
 *
 * Exemplos:
 *   runFullPipeline(1, "conta_azul")
 *   runFullPipeline(1, "omie")
 *   runFullPipeline(1, "totvs")
 *   runFullPipeline(1, "netsuite")
 *   runFullPipeline(1, "sap_b1")
 */
export async function runFullPipeline(
  tenantId: number,
  erpName: string
): Promise<{ pipelineId: number; success: boolean; connectorDir?: string; error?: string }> {
  const erpConfig = await getErpConfig(tenantId, erpName as any);
  if (!erpConfig) throw new Error(`ERP config não encontrado: tenant=${tenantId} erp=${erpName}`);

  const credentials = (erpConfig.credentials as Record<string, string>) || {};
  const docUrl = (erpConfig as any).docUrl as string;
  if (!docUrl) throw new Error(`docUrl obrigatório no ERP config de ${erpName}`);

  const [d, m, g, e] = await Promise.all([
    getModelConfig(tenantId, "discovery"),
    getModelConfig(tenantId, "mapping"),
    getModelConfig(tenantId, "generator"),
    getModelConfig(tenantId, "extractor"),
  ]);

  const modelConfigs: Record<string, ModelConfig> = {
    discovery: d ?? DEFAULT_MODEL_CONFIGS.discovery!,
    mapping: m ?? DEFAULT_MODEL_CONFIGS.mapping!,
    generator: g ?? DEFAULT_MODEL_CONFIGS.generator!,
    extractor: e ?? DEFAULT_MODEL_CONFIGS.extractor!,
  };

  const pipelineId = await createPipeline({
    tenantId, erpType: erpName as any, status: "running", currentStep: "discovery",
  });

  try {
    const result = await pipelineGraph.invoke({
      pipelineId, tenantId, erpName, credentials, docUrl, modelConfigs,
      discoveryResult: undefined, mappingResult: undefined,
      generatorResult: undefined, extractorResult: undefined, error: undefined,
    });

    return {
      pipelineId: result.pipelineId as number,
      success: !result.error,
      connectorDir: result.generatorResult?.connectorDir,
      error: result.error as string,
    };
  } catch (err: any) {
    await updatePipeline(pipelineId, {
      status: "failed", errorMessage: err?.message, finishedAt: new Date(),
    });
    return { pipelineId, success: false, error: err?.message };
  }
}

/** Testa só o Discovery em uma URL — útil para debug sem rodar o pipeline todo */
export async function runDiscoveryOnly(
  erpName: string,
  docUrl: string,
  modelConfig?: ModelConfig
): Promise<DiscoveryResult> {
  const pipelineId = await createPipeline({
    tenantId: 0, erpType: erpName as any, status: "running", currentStep: "discovery",
  });
  const result = await discoveryNode({
    pipelineId, tenantId: 0, erpName, credentials: {}, docUrl,
    modelConfigs: { discovery: modelConfig ?? DEFAULT_MODEL_CONFIGS.discovery! },
    discoveryResult: undefined, mappingResult: undefined,
    generatorResult: undefined, extractorResult: undefined, error: undefined,
    retryCount: 0, lastCodeError: undefined,
  } as PipelineState);
  await updatePipeline(pipelineId, { status: "completed", finishedAt: new Date() });
  return result.discoveryResult!;
}

/** Roda Discovery + Mapping + Generator sem extrair dados reais
 *  Útil para inspecionar o código gerado antes de rodar em produção */
export async function runGeneratorOnly(
  erpName: string,
  docUrl: string,
  credentials: Record<string, string> = {}
): Promise<{ connectorDir: string; files: Record<string, string> }> {
  const pipelineId = await createPipeline({
    tenantId: 0, erpType: erpName as any, status: "running", currentStep: "discovery",
  });

  const modelConfigs = {
    discovery: DEFAULT_MODEL_CONFIGS.discovery!,
    mapping: DEFAULT_MODEL_CONFIGS.mapping!,
    generator: DEFAULT_MODEL_CONFIGS.generator!,
    extractor: DEFAULT_MODEL_CONFIGS.extractor!,
  };

  let st: PipelineState = {
    pipelineId, tenantId: 0, erpName, credentials, docUrl, modelConfigs,
    discoveryResult: undefined, mappingResult: undefined,
    generatorResult: undefined, extractorResult: undefined, error: undefined,
    retryCount: 0, lastCodeError: undefined,
  };

  st = { ...st, ...(await discoveryNode(st)) };
  st = { ...st, ...(await mappingNode(st)) };
  st = { ...st, ...(await generatorNode(st)) };

  await updatePipeline(pipelineId, { status: "completed", finishedAt: new Date() });

  const dir = st.generatorResult!.connectorDir;
  return {
    connectorDir: dir,
    files: {
      "auth.js": fs.readFileSync(path.join(dir, "auth.js"), "utf-8"),
      "extractor.js": fs.readFileSync(path.join(dir, "extractor.js"), "utf-8"),
      "mapper.js": fs.readFileSync(path.join(dir, "mapper.js"), "utf-8"),
      "context.json": fs.readFileSync(path.join(dir, "context.json"), "utf-8"),
    },
  };
}
