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
import {
  fetchDocumentation,
  fetchPage,
  extractUsefulContent,
} from "./docFetcher";
import {
  invokeLLMJson,
  invokeLLMText,
  DEFAULT_MODEL_CONFIGS,
  ModelConfig,
} from "./llmFactory";
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
import { pipelineLocalStorage } from "./logger";

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
  authType: string; // descrição livre: "OAuth2 Bearer", "API Key in body", etc.
  authFields?: string[];
  baseUrl: string;
  endpoints: EndpointInfo[];
  paginationStrategy: string;
  paginationParams: Record<string, string>; // ex: { pageParam: "pagina", sizeParam: "tamanho_pagina" }
  paginationTermination?: string;
  dateParams: Record<string, string>; // ex: { startParam: "data_inicio", endParam: "data_fim" }
  responseEnvelopes: string[]; // chaves JSON que contêm os arrays
  isRpcStyle?: boolean;
  description: string;
  docSource: "live" | "cache" | "fallback" | "direct_download";
  docUrl: string;
  rawDocText: string; // texto bruto — passado para os próximos agentes
  // Exemplos extraídos do crawl seletivo — envelope e primeiro objeto real por entidade
  entityExamples?: Record<
    string,
    { envelope: string; responseExample: string }
  >;
}

export interface MappingResult {
  // Para cada entidade: qual endpoint usar + como mapear campos
  entityMappings: Record<
    EntityType,
    {
      endpoint: EndpointInfo;
      envelope: string; // chave JSON que contém o array na resposta
      dePara: Record<string, string[]>; // canonical_field → [erp_field1, erp_field2, ...]
    }
  >;
}

export interface GeneratorResult {
  // Caminhos dos arquivos JS gerados em disco
  connectorDir: string; // ex: "connectors/conta_azul"
  authFile: string; // ex: "connectors/conta_azul/auth.js"
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
  erpName: Annotation<string>(), // qualquer string — "conta_azul", "omie", "totvs", etc.
  credentials: Annotation<Record<string, string>>(),
  docUrl: Annotation<string>(),
  modelConfigs: Annotation<Record<string, ModelConfig>>(),

  discoveryResult: Annotation<DiscoveryResult | undefined>(),
  mappingResult: Annotation<MappingResult | undefined>(),
  generatorResult: Annotation<GeneratorResult | undefined>(),
  extractorResult: Annotation<ExtractorResult | undefined>(),
  error: Annotation<string | undefined>(),
  retryCount: Annotation<number>({
    reducer: (x, y) => y ?? x,
    default: () => 0,
  }),
  lastCodeError: Annotation<string | undefined>(),
});

type PipelineState = typeof PipelineStateAnnotation.State;

// ─── Phase 0: Direct Documentation Download ────────────────────────────────────
// Tenta baixar doc em formato estruturado (PDF, YAML, JSON, Markdown)
// antes do crawl seletivo de HTML

const CONTENT_KEYWORDS =
  /endpoint|api|auth|request|response|method|parameter|query|body|header|pagination|filter|sort|order|limit|page|schema|format|type/i;
const DOC_EXTENSIONS = /\.(pdf|yaml|yml|json|md|markdown)$/i;
const MAX_DOWNLOADS_PER_SEEDURL = 3;
const MAX_TOTAL_DOWNLOADS = 15;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DOWNLOAD_TIMEOUT = 15000;

async function findDocLinks(pageUrl: string): Promise<string[]> {
  try {
    const res = await axios.get(pageUrl, { timeout: 10000 });
    const $ = cheerio.load(res.data);
    const links = new Set<string>();

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      // Pula links para openapi/swagger (já tratados em Passo 1)
      if (href.includes("openapi") || href.includes("swagger")) return;

      // Verifica se é uma extensão de interesse
      if (DOC_EXTENSIONS.test(href)) {
        try {
          const absoluteUrl = href.startsWith("http")
            ? href
            : new URL(href, pageUrl).toString();
          links.add(absoluteUrl);
        } catch {
          // URL inválida, ignora
        }
      }
    });

    return Array.from(links);
  } catch (err: any) {
    console.warn(
      `[Discovery Phase 0] Falha ao buscar links em ${pageUrl}: ${err.message}`
    );
    return [];
  }
}

async function downloadAndExtractContent(
  fileUrl: string
): Promise<{ content: string; format: string } | null> {
  try {
    const res = await axios.get(fileUrl, {
      timeout: DOWNLOAD_TIMEOUT,
      responseType: "arraybuffer",
      maxContentLength: MAX_FILE_SIZE,
    });

    const buffer = Buffer.from(res.data);
    const contentType = res.headers["content-type"]?.toLowerCase() || "";

    // Detecta formato pela extensão
    let format = "unknown";
    let content = "";

    if (fileUrl.endsWith(".pdf")) {
      format = "pdf";
      try {
        const pdfParse = require("pdf-parse");
        const data = await pdfParse(buffer);
        content = data.text;
      } catch (pdfErr) {
        console.warn(`[Discovery Phase 0] PDF parse falhou para ${fileUrl}`);
        return null;
      }
    } else if (
      fileUrl.endsWith(".json") ||
      contentType.includes("application/json")
    ) {
      format = "json";
      try {
        const obj = JSON.parse(buffer.toString("utf-8"));
        // Converte JSON estruturado para texto legível
        content = JSON.stringify(obj, null, 2);
      } catch {
        content = buffer.toString("utf-8");
      }
    } else if (
      fileUrl.match(/\.(yaml|yml)$/i) ||
      contentType.includes("yaml")
    ) {
      format = "yaml";
      try {
        const jsYaml = require("js-yaml") as any;
        const obj = jsYaml.load(buffer.toString("utf-8"));
        // Converte YAML para JSON string para manter estrutura
        content = JSON.stringify(obj, null, 2);
      } catch {
        content = buffer.toString("utf-8");
      }
    } else if (fileUrl.endsWith(".md") || fileUrl.endsWith(".markdown")) {
      format = "markdown";
      content = buffer.toString("utf-8");
    } else {
      // Tenta como texto genérico
      format = "text";
      content = buffer.toString("utf-8");
    }

    if (!content || content.length < 100) {
      console.warn(
        `[Discovery Phase 0] ${fileUrl}: conteúdo muito curto (${content.length} chars)`
      );
      return null;
    }

    return { content, format };
  } catch (err: any) {
    console.warn(
      `[Discovery Phase 0] Falha ao baixar ${fileUrl}: ${err.message}`
    );
    return null;
  }
}

function validateContent(content: string): boolean {
  // Valida se contém palavras-chave de API
  if (!CONTENT_KEYWORDS.test(content)) {
    return false;
  }
  // Deve ter no mínimo 500 chars de conteúdo útil
  return content.trim().length >= 500;
}

async function tryDirectDocDownload(
  seedUrls: string[]
): Promise<{ rawDocText: string; docSource: "direct_download" } | null> {
  console.log(
    `[Discovery Phase 0] Tentando download direto de documentação estruturada...`
  );

  let totalDownloads = 0;

  for (const seedUrl of seedUrls) {
    if (totalDownloads >= MAX_TOTAL_DOWNLOADS) {
      console.log(
        `[Discovery Phase 0] Limite de downloads (${MAX_TOTAL_DOWNLOADS}) atingido`
      );
      break;
    }

    console.log(`[Discovery Phase 0] Buscando links de doc em ${seedUrl}...`);
    const docLinks = await findDocLinks(seedUrl);

    if (docLinks.length === 0) {
      console.log(
        `[Discovery Phase 0] Nenhum link de doc encontrado em ${seedUrl}`
      );
      continue;
    }

    console.log(
      `[Discovery Phase 0] Encontrados ${docLinks.length} potenciais docs em ${seedUrl}`
    );

    // Tenta baixar até MAX_DOWNLOADS_PER_SEEDURL arquivos por seedUrl
    for (const docLink of docLinks.slice(0, MAX_DOWNLOADS_PER_SEEDURL)) {
      if (totalDownloads >= MAX_TOTAL_DOWNLOADS) break;

      console.log(`[Discovery Phase 0] Baixando ${docLink}...`);
      totalDownloads++;

      const result = await downloadAndExtractContent(docLink);
      if (!result) continue;

      if (validateContent(result.content)) {
        console.log(
          `[Discovery Phase 0] ✅ Conteúdo válido encontrado (${result.format}, ${result.content.length} chars)`
        );
        return {
          rawDocText: result.content,
          docSource: "direct_download",
        };
      } else {
        console.log(
          `[Discovery Phase 0] ❌ ${docLink}: falhou validação (pouco conteúdo ou sem palavras-chave)`
        );
      }
    }
  }

  console.log(
    `[Discovery Phase 0] Nenhum documento válido encontrado via download direto`
  );
  return null;
}

// ─── Node 1: Discovery ─────────────────────────────────────────────────────────
// Única responsabilidade: ler a doc da URL e extrair estrutura da API

async function discoveryNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  const { erpName, docUrl, modelConfigs, pipelineId } = state;
  const config = modelConfigs.discovery ?? DEFAULT_MODEL_CONFIGS.discovery!;

  await updatePipeline(pipelineId, {
    currentStep: "discovery",
    status: "running",
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTRATÉGIA DE ACUMULAÇÃO: Executa todas as fases, acumula conteúdo
  // Critério de parada:
  //   - OpenAPI encontrado → PARA imediatamente (melhor caso)
  //   - Demais phases: continua até cobrir 4 entidades OU 32k chars OU esgotar strategies
  // ═══════════════════════════════════════════════════════════════════════════

  let accumulatedText = "";
  const MAX_ACCUMULATED_CHARS = 32768; // 32KB
  const neededEntities = ["invoices", "receivables", "payables", "customers"];
  const foundEntities = new Set<string>();
  const entityExamples: Record<
    string,
    { envelope: string; responseExample: string }
  > = {};
  let docSource: DiscoveryResult["docSource"] = "fallback";

  console.log(
    `[Discovery] Iniciando acumulação de conteúdo para ${erpName}...`
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 1: OpenAPI/Swagger — PARA se encontrar (melhor case scenario)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`[Discovery] PHASE 1: Procurando OpenAPI/Swagger...`);
  try {
    const openApiResult = await tryOpenApiPhaseAccumulation(docUrl, erpName);
    if (openApiResult.found) {
      // OpenAPI encontrado — PARA aqui, não precisa de mais nada
      await updatePipeline(pipelineId, {
        discoveryResult: openApiResult.result as any,
        currentStep: "mapping",
      });
      console.log(
        `[Discovery] ✅ PHASE 1 OpenAPI encontrado — PARANDO (${openApiResult.result!.endpoints.length} endpoints)`
      );
      return { discoveryResult: openApiResult.result };
    }
  } catch (err) {
    console.warn(`[Discovery] PHASE 1 (OpenAPI) falhou:`, (err as any).message);
  }

  console.log(
    `[Discovery] PHASE 1: OpenAPI não encontrado, continuando acumulação...`
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 2: Download direto de documentação estruturada (.pdf, .yaml, .json, .md)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`[Discovery] PHASE 2: Tentando download direto de docs...`);
  try {
    let initialSeedUrls = [docUrl];
    try {
      const { fetchRootHtml, extractLinksWithText } = await import(
        "./docFetcher.js"
      );
      const rootHtml = await fetchRootHtml(docUrl);
      const links = extractLinksWithText(rootHtml, docUrl);
      if (links.length > 0) {
        initialSeedUrls = initialSeedUrls.concat(
          links.slice(0, 10).map(l => l.href)
        );
      }
    } catch {
      // Continua com docUrl
    }

    const directResult = await tryDirectDocDownload(initialSeedUrls);
    if (directResult && directResult.rawDocText?.length > 0) {
      accumulatedText += directResult.rawDocText;
      docSource = directResult.docSource;
      console.log(
        `[Discovery] PHASE 2 ✅: Download direto bem-sucedido (${directResult.rawDocText.length} chars acumulados)`
      );
    }
  } catch (err) {
    console.warn(`[Discovery] PHASE 2 (Download direto) falhou:`, err);
  }

  // Critério de parada intermediário: OpenAPI encontrado nos seedUrls
  if (accumulatedText.length === 0) {
    console.log(
      `[Discovery] PHASE 2: Nenhum doc direto encontrado, continuando...`
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 3: Extração de sementes e crawl seletivo com intenção
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`[Discovery] PHASE 3: Crawl seletivo com LLM guidance...`);
  let seedUrls: string[] = [docUrl];

  try {
    // Extrai sementes iniciais
    const { fetchRootHtml, extractLinksWithText } = await import(
      "./docFetcher.js"
    );
    const rootHtml = await fetchRootHtml(docUrl);
    const links = extractLinksWithText(rootHtml, docUrl);

    if (links.length > 0) {
      const sampleLinks = links.slice(0, 200);
      try {
        const filteredUrls = await invokeLLMJson<string[]>(
          config,
          `You are an API documentation architect.`,
          `The ERP system is "${erpName}".
We need endpoints for: invoices, receivables, payables, customers, orders, billing.
Links from root page:
${JSON.stringify(sampleLinks)}

Return up to 10 URLs (most likely module entry points).
Return ONLY valid JSON array of strings, no explanation.`
        );
        if (Array.isArray(filteredUrls) && filteredUrls.length > 0) {
          seedUrls = filteredUrls;
          console.log(
            `[Discovery] PHASE 3: ${seedUrls.length} sementes selecionadas`
          );
        }
      } catch {
        console.log(`[Discovery] PHASE 3: LLM de sementes falhou, usando raiz`);
      }
    }
  } catch (err) {
    console.warn(`[Discovery] PHASE 3: Extração de sementes falhou:`, err);
  }

  // Tenta rapidamente OpenAPI nas seedUrls
  try {
    for (const url of seedUrls) {
      try {
        const probe = await axios.get(url, {
          timeout: 5000,
          headers: { Accept: "application/json" },
        });
        if (probe.data?.paths || probe.data?.swagger || probe.data?.openapi) {
          console.log(
            `[Discovery] ✅ OpenAPI detectado em seedUrl: ${url} — PARANDO`
          );
          const openApiResult = await buildOpenApiResult(
            probe.data,
            erpName,
            docUrl
          );
          await updatePipeline(pipelineId, {
            discoveryResult: openApiResult as any,
            currentStep: "mapping",
          });
          return { discoveryResult: openApiResult };
        }
      } catch {
        // Continua
      }
    }
  } catch (err) {
    console.warn(
      `[Discovery] PHASE 3: Tentativa rápida de OpenAPI falhou:`,
      err
    );
  }

  // Crawl seletivo nas seedUrls
  try {
    for (const url of seedUrls) {
      // Critério de parada: cobriu todas as entidades OU atingiu limite de chars
      if (foundEntities.size === neededEntities.length) {
        console.log(
          `[Discovery] PHASE 3: ✅ Todas as ${neededEntities.length} entidades cobertas — PARANDO crawl`
        );
        break;
      }
      if (accumulatedText.length >= MAX_ACCUMULATED_CHARS) {
        console.log(
          `[Discovery] PHASE 3: ✅ Limite de chars (${accumulatedText.length}) atingido — PARANDO crawl`
        );
        break;
      }

      let pageContent = "";
      try {
        const pageResult = await fetchPage(url);
        if (!pageResult) continue;
        pageContent = extractUsefulContent(pageResult.html);

        // Fallback: Playwright se fetchPage retornar <50 chars
        if (pageContent.length < 50) {
          try {
            const { fetchRootHtml } = await import("./docFetcher.js");
            const playwrightHtml = await fetchRootHtml(url);
            const playwrightContent = extractUsefulContent(playwrightHtml);
            if (playwrightContent.length >= 50) {
              pageContent = playwrightContent;
            } else {
              continue;
            }
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }

      if (pageContent.length < 50) continue;

      // LLM: página cobre alguma entidade faltante?
      try {
        const remaining = neededEntities.filter(e => !foundEntities.has(e));
        if (remaining.length === 0) break; // Todas as entidades já foram cobertas

        const verdict = await invokeLLMJson<{
          useful: boolean;
          covers: string[];
          envelope?: string;
          responseExample?: string;
        }>(
          config,
          `You are an API documentation analyst. Answer ONLY with valid JSON.`,
          `Does this documentation contain LIST/GET endpoints for any of: ${remaining.join(", ")}?

Return format:
{
  "useful": true,
  "covers": ["entity"],
  "envelope": "exact JSON key with records array",
  "responseExample": "first record object as JSON string, or empty"
}

CRITICAL: covers MUST be from ["invoices", "receivables", "payables", "customers"] ONLY.
Map: notas fiscais/sales orders → invoices; contas a receber → receivables; contas a pagar → payables; clientes → customers

Page: ${url}
Content:
${pageContent.slice(0, 3000)}`
        );

        const VALID_ENTITIES = new Set([
          "invoices",
          "receivables",
          "payables",
          "customers",
        ]);
        const validCovers = (verdict.covers ?? []).filter(e =>
          VALID_ENTITIES.has(e)
        );

        if (verdict.useful && validCovers.length > 0) {
          // ACUMULA conteúdo desta página
          accumulatedText += `\n\n### Source: ${url}\n\n${pageContent}`;
          validCovers.forEach(e => {
            foundEntities.add(e);
            if (!entityExamples[e]) {
              entityExamples[e] = {
                envelope: verdict.envelope ?? "",
                responseExample: verdict.responseExample ?? "",
              };
            }
          });
          console.log(
            `[Discovery] PHASE 3 ✅: ${url} → [${validCovers.join(", ")}] (${foundEntities.size}/${neededEntities.length}, ${accumulatedText.length} chars)`
          );
        } else {
          console.log(`[Discovery] PHASE 3: ${url} → não útil`);
        }
      } catch (llmErr) {
        console.warn(
          `[Discovery] PHASE 3 LLM: ${url} falhou`,
          (llmErr as any)?.message
        );
        // Em caso de erro, inclui por precaução (acumula sempre)
        accumulatedText += `\n\n### Source: ${url}\n\n${pageContent}`;
      }
    }
  } catch (err) {
    console.warn(`[Discovery] PHASE 3 (Crawl seletivo) falhou:`, err);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 4: Fallback crawl tradicional (apenas se ainda faltam entidades)
  // ─────────────────────────────────────────────────────────────────────────────
  const remainingAfterPhase3 = neededEntities.filter(
    e => !foundEntities.has(e)
  );
  if (
    remainingAfterPhase3.length > 0 &&
    accumulatedText.length < MAX_ACCUMULATED_CHARS
  ) {
    console.log(
      `[Discovery] PHASE 4: Fallback crawl tradicional (faltam: ${remainingAfterPhase3.join(", ")})...`
    );
    try {
      const fetched = await fetchDocumentation(docUrl, seedUrls);
      if (fetched.combinedText && fetched.combinedText.length > 200) {
        accumulatedText += `\n\n### Fallback crawl tradicional\n\n${fetched.combinedText}`;
        docSource = fetched.source as DiscoveryResult["docSource"];
        console.log(
          `[Discovery] PHASE 4 ✅: ${fetched.pages.length} páginas (+${fetched.combinedText.length} chars)`
        );
      }
    } catch (err) {
      console.warn(`[Discovery] PHASE 4 (Fallback crawl) falhou:`, err);
    }
  } else {
    console.log(
      `[Discovery] PHASE 4: Pulando fallback (entidades: ${foundEntities.size}, chars: ${accumulatedText.length})`
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 5: LLM com TODO conteúdo acumulado
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(
    `[Discovery] PHASE 5: LLM com ${accumulatedText.length} chars acumulados...`
  );

  const systemPrompt = `You are a senior API integration engineer specialized in ERP systems.

Extract a precise API structure from raw documentation.

Rules:
- If documentation lacks details, use pre-trained ERP knowledge to fill auth/endpoints.
- For auth: describe EXACTLY what credentials + WHERE they go.
- For pagination: describe EXACTLY the END condition (e.g., "stop when array length < page_size").
- RPC APIs: method=POST with action field.
- ONLY extract LIST/GET endpoints for bulk reads (ListarClientes, Search Invoices, etc.).
- NEVER extract CREATE/UPDATE/DELETE or single-item lookups.
- Extract EXACT paths relative to baseUrl.
- Return ONLY valid JSON.

CRITICAL: If entityExamples are provided below, use them to determine envelope keys and field names.
Do NOT invent. Use ONLY field names visible in responseExample or mentioned in documentation.`;

  const buildExamplesSection = (): string => {
    if (Object.keys(entityExamples).length === 0) return "";
    const lines = Object.entries(entityExamples).map(([entity, data]) => {
      return `${entity}: envelope="${data.envelope}", example=${
        data.responseExample && data.responseExample.trim().length > 2
          ? data.responseExample.slice(0, 200)
          : "(not in docs — search for this envelope in DOCUMENTATION EXCERPT)"
      }`;
    });
    return `\n\nENTITY EXAMPLES (SOURCE OF TRUTH):\n${lines.join("\n")}\n`;
  };

  const userPrompt = `ERP: "${erpName}"
Documentation URL: ${docUrl}
${buildExamplesSection()}

RAW DOCUMENTATION:
${accumulatedText || "(fetch failed — use ERP pre-trained knowledge)"}

Return JSON:
{
  "authType": "full description of credentials + where they go",
  "authFields": ["credential field names"],
  "baseUrl": "https://...",
  "endpoints": [
    {
      "method": "GET|POST",
      "path": "/endpoint/path",
      "description": "what entity",
      "queryParams": ["param1"],
      "bodyParams": ["param1"],
      "action": "RPC action name if applicable"
    }
  ],
  "paginationStrategy": "exact pagination method",
  "paginationParams": {
    "pageParam": "exact param name",
    "sizeParam": "exact param name",
    "defaultPageSize": 50
  },
  "paginationTermination": "exact stop condition",
  "dateParams": {
    "startParam": "exact param name",
    "endParam": "exact param name",
    "dateFormat": "YYYY-MM-DD or DD/MM/YYYY"
  },
  "responseEnvelopes": ["exact JSON keys"],
  "isRpcStyle": false,
  "description": "1-2 sentence summary"
}`;

  try {
    const result = await invokeLLMJson<
      Omit<DiscoveryResult, "docSource" | "docUrl" | "rawDocText">
    >(config, systemPrompt, userPrompt);

    const discoveryResult: DiscoveryResult = {
      authType: result.authType || "unknown",
      authFields: result.authFields || [],
      baseUrl: result.baseUrl || docUrl,
      endpoints: Array.isArray(result.endpoints) ? result.endpoints : [],
      paginationStrategy: result.paginationStrategy || "",
      paginationParams: result.paginationParams || {},
      paginationTermination:
        result.paginationTermination || "response array length is 0",
      dateParams: result.dateParams || {},
      responseEnvelopes: result.responseEnvelopes || [],
      isRpcStyle: result.isRpcStyle || false,
      description: result.description || "",
      docSource,
      docUrl,
      rawDocText: accumulatedText,
      entityExamples,
    };

    await updatePipeline(pipelineId, {
      discoveryResult: discoveryResult as any,
    });
    console.log(
      `[Discovery] ✅ OK — auth: ${discoveryResult.authType} | endpoints: ${discoveryResult.endpoints.length} | entities found: [${Array.from(foundEntities).join(", ")}]`
    );
    return { discoveryResult };
  } catch (err: any) {
    console.error("[Discovery] PHASE 5 (LLM) falhou:", err.message);
    return {
      discoveryResult: {
        authType: "unknown",
        authFields: [],
        baseUrl: docUrl,
        endpoints: [],
        paginationStrategy: "",
        paginationParams: {},
        paginationTermination: "stop when array is empty",
        dateParams: {},
        responseEnvelopes: [],
        isRpcStyle: false,
        description: "discovery failed",
        docSource: "fallback",
        docUrl,
        rawDocText: accumulatedText,
      },
    };
  }
}

// ─── Função helper: Tenta OpenAPI — retorna estrutura pronta ou { found: false }
async function tryOpenApiPhaseAccumulation(
  docUrl: string,
  erpName: string
): Promise<{ found: boolean; result?: DiscoveryResult }> {
  try {
    const resHTML = await axios.get(docUrl, { timeout: 15000 });
    const $ = cheerio.load(resHTML.data);

    let jsonUrl = "";
    $("a, link").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (
        href &&
        (href.endsWith(".json") ||
          href.includes("swagger") ||
          href.includes("openapi"))
      ) {
        jsonUrl = href.startsWith("http")
          ? href
          : new URL(href, docUrl).toString();
      }
    });

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
        } catch {
          // Continua
        }
      }
    }

    if (!jsonUrl) {
      return { found: false };
    }

    const specRes = await axios.get(jsonUrl, { timeout: 15000 });
    const spec = specRes.data;

    if (!spec?.paths) {
      return { found: false };
    }

    const result = await buildOpenApiResult(spec, erpName, docUrl);
    return { found: true, result };
  } catch {
    return { found: false };
  }
}

// ─── Função helper: Constrói DiscoveryResult a partir de spec OpenAPI
async function buildOpenApiResult(
  spec: any,
  erpName: string,
  docUrl: string
): Promise<DiscoveryResult> {
  const endpoints: EndpointInfo[] = [];
  for (const [p_path, p_methods] of Object.entries<any>(spec.paths || {})) {
    for (const method of ["get", "post", "put", "patch"] as const) {
      if (!p_methods[method]) continue;
      const op = p_methods[method];
      endpoints.push({
        method: method.toUpperCase() as "GET" | "POST",
        path: p_path,
        description: op.summary || op.description || p_path,
        queryParams: (op.parameters || [])
          .filter((p: any) => p.in === "query")
          .map((p: any) => p.name),
        bodyParams: op.requestBody
          ? Object.keys(
              op.requestBody?.content?.["application/json"]?.schema
                ?.properties || {}
            )
          : [],
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

  return {
    authType,
    authFields,
    baseUrl: spec.servers?.[0]?.url || docUrl,
    endpoints,
    paginationStrategy: "page and size query params",
    paginationParams: {
      pageParam: "page",
      sizeParam: "size",
      defaultPageSize: "50",
    } as any,
    paginationTermination:
      "stop when response array length is 0 or less than page size",
    dateParams: {},
    responseEnvelopes: ["data", "items", "results"],
    isRpcStyle: false,
    description: spec.info?.description || spec.info?.title || erpName,
    docSource: "live",
    docUrl,
    rawDocText: JSON.stringify(spec).slice(0, 4000),
  };
}

// ─── Node 2: Mapping ───────────────────────────────────────────────────────────
// Única responsabilidade: para cada entidade canônica, qual endpoint + campos

async function mappingNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  const { erpName, discoveryResult, modelConfigs, pipelineId } = state;
  const config = modelConfigs.mapping ?? DEFAULT_MODEL_CONFIGS.mapping!;

  await updatePipeline(pipelineId, { currentStep: "mapping" });

  // DEBUG: confirma se entityExamples chegou do Discovery
  console.log(
    "[Mapping] entityExamples recebidos:",
    JSON.stringify(discoveryResult?.entityExamples ?? null)
  );
  console.log(
    "[Mapping] discoveryResult keys:",
    Object.keys(discoveryResult ?? {}).join(", ")
  );

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
      const hasExample =
        data.responseExample && data.responseExample.trim().length > 2;
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
${discoveryResult?.endpoints
  ?.map(
    e =>
      `  ${e.method} ${e.path}${e.action ? ` action="${e.action}"` : ""} — ${e.description}`
  )
  .join("\n")}

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
    const result = await invokeLLMJson<{
      entityMappings: MappingResult["entityMappings"];
    }>(config, systemPrompt, userPrompt);
    const mappingResult: MappingResult = {
      entityMappings: result.entityMappings,
    };
    await updatePipeline(pipelineId, { mappingResult: mappingResult as any });
    console.log(
      `[Mapping] OK — entidades: ${Object.keys(mappingResult.entityMappings).join(", ")}`
    );
    return { mappingResult };
  } catch (err: any) {
    console.error("[Mapping] LLM falhou:", err.message);
    return { mappingResult: undefined };
  }
}

// ─── Node 3: Generator ─────────────────────────────────────────────────────────
async function generatorNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  const {
    erpName,
    credentials,
    discoveryResult,
    mappingResult,
    modelConfigs,
    pipelineId,
  } = state;
  const config = modelConfigs.generator ?? DEFAULT_MODEL_CONFIGS.generator!;
  const mapperConfig = DEFAULT_MODEL_CONFIGS.generator_mapper!;

  await updatePipeline(pipelineId, {
    currentStep: "generator",
    status: "running",
  });

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
The request example in the documentation is the absolute source of truth for the body structure.

CRITICAL SECURITY RULE — OAUTH2 BEARER TOKEN FLOWS:
For OAuth2 Bearer Token APIs, getAuthBody MUST return {}.
Credentials go ONLY in getAuthHeaders as Authorization: Bearer.
Never put grant_type, client_id or client_secret in getAuthBody — those are used only during the OAuth flow, not during API calls.
The requestExample from the documentation is the source of truth for where credentials go.`;

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

    const clean = (code: string) =>
      code
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
        extractorCode = extractorCode.replace(
          envPattern,
          `"${correctEnvelope}"`
        );
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
    console.log(
      `[Generator] Arquivos Fase 1 salvos. Iniciando extração teste para o Mapper...`
    );
    const rawExamples: Record<string, unknown> = {};
    try {
      delete require.cache[require.resolve(extractorFile)];
      delete require.cache[require.resolve(authFile)];
      const { extractRawData } = require(extractorFile);

      const entities = ["invoices", "receivables", "payables", "customers"];
      for (const entity of entities) {
        try {
          // Passamos maxPages = 1 para capturar apenas a primeira página rápido
          const data = await extractRawData(
            credentials,
            entity,
            discoveryResult?.baseUrl || "",
            1
          );
          if (Array.isArray(data) && data.length > 0) {
            rawExamples[entity] = data[0]; // Guarda o primeiro registro como Ground Truth
            console.log(`[Generator] Amostra real capturada para ${entity}`);
          }
        } catch (e: any) {
          console.warn(
            `[Generator] Teste de extração falhou para ${entity}:`,
            e.message
          );
        }
      }
    } catch (e: any) {
      console.warn(
        `[Generator] Falha ao carregar extractor para teste:`,
        e.message
      );
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

    const mapperRawText = await invokeLLMText(
      mapperConfig,
      mapperSystemPrompt,
      mapperUserPrompt
    );
    fs.writeFileSync(mapperFile, clean(mapperRawText), "utf-8");

    fs.writeFileSync(
      path.join(connectorDir, "context.json"),
      JSON.stringify(
        {
          erpName,
          discovery: state.discoveryResult,
          mapping: state.mappingResult,
        },
        null,
        2
      ),
      "utf-8"
    );

    // ── Validação genérica do auth.js gerado ─────────────────────────────────
    // Carrega o módulo e verifica se ao menos um dos três métodos retorna algo não-vazio.
    // Um cenário onde todos retornam {} significa que o LLM não entendeu onde as credenciais vão.
    try {
      delete require.cache[require.resolve(authFile)];
      const authModule = require(authFile);
      const testBody = authModule.getAuthBody?.({}, "test") ?? {};
      const testHeaders = authModule.getAuthHeaders?.({}) ?? {};
      const testParams = authModule.getAuthQueryParams?.({}) ?? {};
      const bodyKeys = Object.keys(testBody).filter(k => k !== "undefined");
      const headerKeys = Object.keys(testHeaders);
      const paramKeys = Object.keys(testParams);
      const allEmpty =
        bodyKeys.length === 0 &&
        headerKeys.length === 0 &&
        paramKeys.length === 0;

      if (allEmpty) {
        const validationError =
          `auth.js inválido: getAuthBody/getAuthHeaders/getAuthQueryParams todos retornam {}.\n` +
          `ERP: ${erpName} | authType: ${discoveryResult?.authType}\n` +
          `O LLM deve colocar as credenciais em pelo menos um desses métodos conforme a documentação.`;
        console.warn(
          `[Generator] ⚠️ Validação auth.js FALHOU — todos os métodos retornam {}.`
        );
        if (state.retryCount < 3) {
          return {
            retryCount: state.retryCount + 1,
            lastCodeError: validationError,
          };
        }
        // Após 3 tentativas, continua mesmo assim para não travar o pipeline
        console.warn(
          `[Generator] Continuando após ${state.retryCount} tentativas sem auth válido.`
        );
      } else {
        console.log(
          `[Generator] ✅ Validação auth.js OK — body:[${bodyKeys.join(",")}] headers:[${headerKeys.join(",")}] params:[${paramKeys.join(",")}]`
        );
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

    const generatorResult: GeneratorResult = {
      connectorDir,
      authFile,
      extractorFile,
      mapperFile,
    };
    await updatePipeline(pipelineId, {
      generatorResult: generatorResult as any,
    });
    return { generatorResult };
  } catch (err: any) {
    console.error("[Generator] Falhou:", err.message);
    return { error: `Generator falhou: ${err.message}` };
  }
}

// ─── Node 4: Extractor ─────────────────────────────────────────────────────────
// Única responsabilidade: require() dos arquivos gerados, executar, persistir
// Zero lógica de ERP aqui. Se os arquivos gerados funcionam, isso funciona.

async function extractorNode(
  state: PipelineState
): Promise<Partial<PipelineState>> {
  const {
    tenantId,
    erpName,
    credentials,
    generatorResult,
    mappingResult,
    discoveryResult,
    pipelineId,
  } = state;

  if (!generatorResult) {
    const errorMsg = state.error || "Generator não rodou";
    await updatePipeline(pipelineId, {
      status: "failed",
      errorMessage: errorMsg,
    });
    return { error: errorMsg };
  }

  await updatePipeline(pipelineId, { currentStep: "extractor" });

  const baseUrl = discoveryResult?.baseUrl || credentials.base_url || "";

  // Carrega os módulos gerados do disco
  // Invalida o cache do require para sempre pegar a versão mais recente
  let extractRawData: (
    creds: Record<string, string>,
    entity: EntityType,
    baseUrl: string,
    discoveryResult: any
  ) => Promise<Record<string, unknown>[]>;
  let normalize: (
    raw: Record<string, unknown>,
    entity: EntityType
  ) => Record<string, unknown>;

  try {
    delete require.cache[require.resolve(generatorResult.extractorFile)];
    delete require.cache[require.resolve(generatorResult.authFile)];
    delete require.cache[require.resolve(generatorResult.mapperFile)];

    const extractorModule = require(generatorResult.extractorFile);
    const mapperModule = require(generatorResult.mapperFile);

    extractRawData = extractorModule.extractRawData;
    normalize = mapperModule.normalize;

    if (typeof extractRawData !== "function")
      throw new Error("extractRawData não exportado");
    if (typeof normalize !== "function")
      throw new Error("normalize não exportado");
  } catch (err: any) {
    console.error(
      "[Extractor] Falha ao carregar módulos gerados:",
      err.message
    );

    // Self-healing loop: volta pro generator se < 3 retentativas
    if (state.retryCount < 3) {
      console.log(
        `[Extractor] Iniciando Self-Healing. Tentativa ${state.retryCount + 1}/3...`
      );
      return {
        retryCount: state.retryCount + 1,
        lastCodeError: err.stack || err.message,
      };
    }

    await updatePipeline(pipelineId, {
      status: "failed",
      errorMessage: err.message,
    });
    return { error: err.message };
  }

  const entities: EntityType[] = [
    "invoices",
    "receivables",
    "payables",
    "customers",
  ];
  const byEntity: Record<EntityType, number> = {
    invoices: 0,
    receivables: 0,
    payables: 0,
    customers: 0,
  };
  const sample: ExtractorResult["sample"] = [];
  let totalRecords = 0;

  for (const entityType of entities) {
    const logId = await createExtractionLog({
      tenantId,
      pipelineId,
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
      console.log(
        `[Extractor] ${entityType}: ${rawItems.length} registros brutos`
      );
    } catch (extractErr: any) {
      const msg = extractErr.message || "";
      if (msg.includes("500") || msg.includes("404")) {
        console.log(
          `[Extractor] ${entityType}: Retornou 500/404. Assumindo lista vazia.`
        );
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
          const forgeConfigured =
            forgeUrl &&
            !forgeUrl.includes("localhost") &&
            !forgeUrl.includes("127.0.0.1");
          if (forgeConfigured) {
            try {
              const { key } = await storagePut(
                rawKey,
                JSON.stringify(raw),
                "application/json"
              );
              storageKey = key;
            } catch {
              /* best effort */
            }
          }

          // Persiste no banco usando as funções canônicas
          await persistRecord(
            normalized,
            entityType,
            tenantId,
            erpName,
            storageKey
          );

          if (sample.length < 5)
            sample.push({ entity: entityType, externalId, raw });
          entityRecords++;
          totalRecords++;
        } catch (itemErr: any) {
          entityFailed++;
          console.error(
            `[Extractor] Item ${entityType} falhou:`,
            itemErr.message
          );
        }
      }

      await updateExtractionLog(logId, {
        status:
          entityFailed > 0 && entityRecords === 0
            ? "failed"
            : entityFailed > 0
              ? "partial"
              : "success",
        recordsProcessed: entityRecords,
        recordsFailed: entityFailed,
        finishedAt: new Date(),
      });
    } catch (entityErr: any) {
      console.error(
        `[Extractor] Entidade ${entityType} falhou:`,
        entityErr.message
      );
      await updateExtractionLog(logId, {
        status: "failed",
        errorMessage: entityErr.message,
        recordsProcessed: entityRecords,
        finishedAt: new Date(),
      });

      // Self-healing loop on runtime execution error
      if (state.retryCount < 3) {
        console.log(
          `[Extractor] Falha em execução de ${entityType}. Iniciando Self-Healing. Tentativa ${state.retryCount + 1}/3...`
        );
        return {
          retryCount: state.retryCount + 1,
          lastCodeError: `Error extracting ${entityType}: ${entityErr.stack || entityErr.message}`,
        };
      }
    }

    byEntity[entityType] = entityRecords;
  }

  const extractorResult: ExtractorResult = {
    recordsCount: totalRecords,
    byEntity,
    sample,
  };
  console.log(`\n[Extractor] 🎯 EXTRAÇÃO FINALIZADA COM SUCESSO!`);
  console.log(
    `[Extractor] Total de registros salvos no banco: ${totalRecords}`
  );

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
    if (p.length === 3)
      return `${p[2]}-${p[1]!.padStart(2, "0")}-${p[0]!.padStart(2, "0")}`;
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
    paidAmount: pick(dePara.paid_amount)
      ? amount(pick(dePara.paid_amount))
      : undefined,
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
  const str = (v: unknown) => (v ? String(v) : undefined);
  // Campos com limite fixo de 2 chars — garante que valores longos (nomes mapeados errado) não causem erro no MySQL strict mode
  const code2 = (v: unknown): string | undefined => {
    const s = v ? String(v).trim() : "";
    if (!s) return undefined;
    return s.length <= 2 ? s : undefined; // descarta se não parece código de estado/país
  };

  if (entity === "invoices") {
    await upsertInvoice({
      tenantId,
      source,
      externalId,
      customerName: str(n.customerName) ?? "N/A",
      issueDate: str(n.issueDate),
      grossAmount: str(n.grossAmount) ?? "0",
      rawStorageKey,
      status: "open",
    });
  } else if (entity === "receivables") {
    await upsertReceivable({
      tenantId,
      source,
      externalId,
      customerName: str(n.customerName) ?? "N/A",
      issueDate: str(n.issueDate),
      dueDate: str(n.dueDate),
      grossAmount: str(n.grossAmount) ?? "0",
      paidAmount: str(n.paidAmount),
      documentType: str(n.documentType) ?? "",
      documentNumber: str(n.documentNumber) ?? "",
      status: "open",
      rawStorageKey,
    });
  } else if (entity === "payables") {
    await upsertPayable({
      tenantId,
      source,
      externalId,
      supplierName: str(n.supplierName) ?? "N/A",
      issueDate: str(n.issueDate),
      dueDate: str(n.dueDate),
      grossAmount: str(n.grossAmount) ?? "0",
      paidAmount: str(n.paidAmount),
      documentType: str(n.documentType) ?? "",
      documentNumber: str(n.documentNumber) ?? "",
      category: str(n.category) ?? "",
      status: "open",
      rawStorageKey,
    });
  } else if (entity === "customers") {
    const doc = str(n.document) ?? "";
    const digits = doc.replace(/\D/g, "");
    const docType =
      digits.length === 11 ? "cpf" : digits.length === 14 ? "cnpj" : undefined;
    await upsertCustomer({
      tenantId,
      source,
      externalId,
      name: str(n.name) ?? "N/A",
      tradeName: str(n.tradeName),
      document: doc || undefined,
      documentType: docType as any,
      email: str(n.email),
      phone: str(n.phone),
      city: str(n.city),
      state: code2(n.state), // VARCHAR(2) — descarta se não for código de 2 letras
      country: code2(n.country), // VARCHAR(2) — idem
      status: "active",
      rawStorageKey,
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
    .addConditionalEdges("extractor", state => {
      // Se não há resultado gerado mas houve increment de retry (teve erro de código),
      // e ainda não estouramos o limite, volta pro generator
      if (
        state.lastCodeError &&
        state.retryCount > 0 &&
        state.retryCount <= 3
      ) {
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
): Promise<{
  pipelineId: number;
  success: boolean;
  connectorDir?: string;
  error?: string;
}> {
  const erpConfig = await getErpConfig(tenantId, erpName as any);
  if (!erpConfig)
    throw new Error(
      `ERP config não encontrado: tenant=${tenantId} erp=${erpName}`
    );

  const credentials = (erpConfig.credentials as Record<string, string>) || {};
  const docUrl = (erpConfig as any).docUrl as string;
  if (!docUrl)
    throw new Error(`docUrl obrigatório no ERP config de ${erpName}`);

  const [d, m, g, e] = await Promise.all([
    getModelConfig(tenantId, "discovery"),
    getModelConfig(tenantId, "mapping"),
    getModelConfig(tenantId, "generator"),
    getModelConfig(tenantId, "extractor"),
  ]);

  const firstAvailable = d ?? m ?? g ?? e;

  const modelConfigs: Record<string, ModelConfig> = {
    discovery: d ?? firstAvailable ?? DEFAULT_MODEL_CONFIGS.discovery!,
    mapping: m ?? firstAvailable ?? DEFAULT_MODEL_CONFIGS.mapping!,
    generator: g ?? firstAvailable ?? DEFAULT_MODEL_CONFIGS.generator!,
    extractor: e ?? firstAvailable ?? DEFAULT_MODEL_CONFIGS.extractor!,
  };

  const pipelineId = await createPipeline({
    tenantId,
    erpType: erpName as any,
    status: "running",
    currentStep: "discovery",
  });

  try {
    const result = await pipelineLocalStorage.run({ pipelineId }, async () => {
      return await pipelineGraph.invoke({
        pipelineId,
        tenantId,
        erpName,
        credentials,
        docUrl,
        modelConfigs,
        discoveryResult: undefined,
        mappingResult: undefined,
        generatorResult: undefined,
        extractorResult: undefined,
        error: undefined,
        retryCount: 0,
        lastCodeError: undefined,
      });
    });

    // Agendar limpeza de logs em 1 hora para não vazar memória
    setTimeout(async () => {
      const { clearLogs } = await import("./logger");
      clearLogs(pipelineId);
    }, 1000 * 60 * 60);

    return {
      pipelineId: result.pipelineId as number,
      success: !result.error,
      connectorDir: result.generatorResult?.connectorDir,
      error: result.error as string,
    };
  } catch (err: any) {
    await updatePipeline(pipelineId, {
      status: "failed",
      errorMessage: err?.message,
      finishedAt: new Date(),
    });
    
    // Agendar limpeza de logs também em caso de erro
    setTimeout(async () => {
      const { clearLogs } = await import("./logger");
      clearLogs(pipelineId);
    }, 1000 * 60 * 60);

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
    tenantId: 0,
    erpType: erpName as any,
    status: "running",
    currentStep: "discovery",
  });
  const result = await pipelineLocalStorage.run({ pipelineId }, async () => {
    return await discoveryNode({
      pipelineId,
      tenantId: 0,
      erpName,
      credentials: {},
      docUrl,
      modelConfigs: {
        discovery: modelConfig ?? DEFAULT_MODEL_CONFIGS.discovery!,
      },
      discoveryResult: undefined,
      mappingResult: undefined,
      generatorResult: undefined,
      extractorResult: undefined,
      error: undefined,
      retryCount: 0,
      lastCodeError: undefined,
    } as PipelineState);
  });
  await updatePipeline(pipelineId, {
    status: "completed",
    finishedAt: new Date(),
  });
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
    tenantId: 0,
    erpType: erpName as any,
    status: "running",
    currentStep: "discovery",
  });

  const modelConfigs = {
    discovery: DEFAULT_MODEL_CONFIGS.discovery!,
    mapping: DEFAULT_MODEL_CONFIGS.mapping!,
    generator: DEFAULT_MODEL_CONFIGS.generator!,
    extractor: DEFAULT_MODEL_CONFIGS.extractor!,
  };

  let st: PipelineState = {
    pipelineId,
    tenantId: 0,
    erpName,
    credentials,
    docUrl,
    modelConfigs,
    discoveryResult: undefined,
    mappingResult: undefined,
    generatorResult: undefined,
    extractorResult: undefined,
    error: undefined,
    retryCount: 0,
    lastCodeError: undefined,
  };

  await pipelineLocalStorage.run({ pipelineId }, async () => {
    st = { ...st, ...(await discoveryNode(st)) };
    st = { ...st, ...(await mappingNode(st)) };
    st = { ...st, ...(await generatorNode(st)) };
  });

  await updatePipeline(pipelineId, {
    status: "completed",
    finishedAt: new Date(),
  });

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
