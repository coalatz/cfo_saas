import { chromium } from "playwright";
import axios from "axios";
import * as cheerio from "cheerio";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocPage {
  url: string;
  title: string;
  content: string; // cleaned plain text
}

export interface FetchedDoc {
  mainUrl: string;
  pages: DocPage[];
  combinedText: string; 
  fetchedAt: Date;
  source: "live" | "cache" | "fallback";
  error?: string;
  openapi?: {
    authType: string;
    endpoints: string[];
    paginationParams?: Record<string, string>;
    dateParams?: Record<string, string>;
  };
}

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_CHARS_PER_PAGE = 6_000;
const MAX_TOTAL_CHARS = 32_000;
const MAX_PAGES = 20;        // máximo de páginas totais
const MAX_DEPTH = 3;         // profundidade máxima de crawl
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; CFO-SaaS-Bot/1.0)",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
};

// ─── In-memory cache ──────────────────────────────────────────────────────────

const docCache = new Map<string, FetchedDoc>();

function getCached(url: string): FetchedDoc | null {
  const cached = docCache.get(url);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt.getTime() > CACHE_TTL_MS) {
    docCache.delete(url);
    return null;
  }
  return { ...cached, source: "cache" };
}

// ─── HTML Cleaner ─────────────────────────────────────────────────────────────

export function isSameDomain(h1: string, h2: string) {
  const getRoot = (h: string) => {
    const p = h.split('.');
    if (p.length <= 2) return h;
    if (['com', 'org', 'net', 'gov', 'co', 'edu'].includes(p[p.length - 2])) {
      return p.slice(-3).join('.');
    }
    return p.slice(-2).join('.');
  };
  return getRoot(h1) === getRoot(h2);
}

function cleanHtml(html: string, baseUrl: string): { title: string; text: string; links: string[] } {
  const $ = cheerio.load(html);

  $("script, style, noscript, iframe, svg, img, video, audio").remove();
  $("nav, header, footer, .sidebar, .nav, .menu, .cookie, .banner, .advertisement").remove();
  $("[class*='nav'], [class*='menu'], [class*='footer'], [class*='header'], [class*='sidebar']").remove();
  $("[id*='nav'], [id*='menu'], [id*='footer'], [id*='header'], [id*='sidebar']").remove();

  const title = $("title").text().trim() || $("h1").first().text().trim() || "Untitled";

  const contentEl = $("main, article, .content, .docs, .documentation, #content, #docs").first();
  const textSource = contentEl.length ? contentEl : $("body");

  let text = "";
  textSource.find("h1, h2, h3, h4, p, li, pre, code, td, th").each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase();
    const raw = $(el).text().replace(/\s+/g, " ").trim();
    if (!raw || raw.length < 3) return;
    if (["h1", "h2", "h3", "h4"].includes(tag)) text += `\n\n## ${raw}\n`;
    else if (tag === "pre" || tag === "code") text += `\n\`\`\`\n${raw}\n\`\`\`\n`;
    else if (tag === "li") text += `\n- ${raw}`;
    else text += `\n${raw}`;
  });

  text = text.replace(/\n{3,}/g, "\n\n").trim();
  // ── Links: mesmo root domain, sem fragmentos ──────────────
  const base = new URL(baseUrl);

  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    try {
      const resolved = new URL(href, baseUrl);
      if (
        isSameDomain(resolved.hostname, base.hostname) && // permite subdomínios (ex: developer.omie e app.omie)
        !resolved.hash &&                                 // sem fragmento #
        resolved.toString() !== baseUrl                   // não é a própria página
      ) {
        const clean = resolved.origin + resolved.pathname; // remove query string e hash
        if (!links.includes(clean)) links.push(clean);
      }
    } catch { /* URL inválida */ }
  });

  return { title, text: text.substring(0, MAX_CHARS_PER_PAGE), links };
}

// ─── Exported Phase 1 Helpers ─────────────────────────────────────────────────

export async function fetchRootHtml(docUrl: string): Promise<string> {
  console.log(`[DocFetcher] Fetching root HTML for ${docUrl}...`);
  let browser: any;
  try {
    const wsEndpoint = process.env.BROWSERLESS_URL || (process.env.BROWSERLESS_TOKEN ? `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}` : "");
    if (wsEndpoint) {
      console.log(`[DocFetcher] Conectando via WebSocket no Browserless...`);
      browser = await chromium.connect({ wsEndpoint, timeout: 15000 });
    } else {
      browser = await chromium.launch({ headless: true });
    }
    const page = await browser.newPage();
    
    // Timeout longo (90s) para garantir que dê tempo de renderizar o JS pesado, mas não trave infinito
    const result = await Promise.race([
      (async () => {
        await page.goto(docUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1000);
        return await page.content();
      })(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Playwright hard timeout")), 90000))
    ]);
    return result;
  } finally {
    if (browser) {
      await Promise.race([
        browser.close().catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 5000))
      ]);
    }
  }
}

export function extractLinksWithText(html: string, baseUrl: string): Array<{ text: string, href: string }> {
  const $ = cheerio.load(html);
  const links: Array<{ text: string, href: string }> = [];
  const base = new URL(baseUrl);
  
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text || text.length < 3) return;
    
    try {
      const resolved = new URL(href, baseUrl);
      if (
        isSameDomain(resolved.hostname, base.hostname) &&
        !resolved.hash &&
        resolved.toString() !== baseUrl
      ) {
        const clean = resolved.origin + resolved.pathname;
        if (!links.some(l => l.href === clean)) {
          links.push({ text, href: clean });
        }
      }
    } catch { /* ignore */ }
  });
  return links;
}

// ─── OpenAPI Parser ───────────────────────────────────────────────────────────

async function fetchOpenApiSpec(url: string) {
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const spec = res.data;
    if (typeof spec !== 'object' || !spec.paths) return null;

    const endpoints: string[] = [];
    const dateParams: Record<string, string> = {};
    const paginationParams: Record<string, string> = {};

    for (const [p_path, p_methods] of Object.entries(spec.paths as Record<string, any>)) {
      if (!p_methods.get) continue;
      const parameters = p_methods.get.parameters || [];
      const queryParams = parameters.filter((p: any) => p.in === 'query').map((p: any) => p.name);
      
      if (queryParams.length > 0) {
        endpoints.push(`GET ${p_path} (Query params: ${queryParams.join(', ')})`);
      } else {
        endpoints.push(`GET ${p_path}`);
      }

      for (const q of queryParams) {
        const ql = String(q).toLowerCase();
        if (ql.includes('page') || ql.includes('pagina')) paginationParams.page = q;
        if (ql.includes('size') || ql.includes('tamanho')) paginationParams.size = q;
        if (ql.includes('start') || ql.includes('inicio')) dateParams.start = q;
        if (ql.includes('end') || ql.includes('fim')) dateParams.end = q;
      }
    }

    const secSchemes = spec.components?.securitySchemes || {};
    const authType = Object.keys(secSchemes).length > 0 ? Object.keys(secSchemes).join(", ") : "Bearer/OAuth2";

    return { authType, endpoints, paginationParams, dateParams };

  } catch (err) {
    console.warn("[DocFetcher] Falha ao baixar/parsear JSON OpenAPI:", err);
    return null;
  }
}

// ─── Fetch single page (Fallback) ─────────────────────────────────────────────

export async function fetchPage(url: string): Promise<{ html: string } | null> {
  try {
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 5,
      responseType: "text",
    });
    if (typeof response.data === "string") return { html: response.data };
    return null;
  } catch (err: any) {
    console.warn(`[DocFetcher] Failed to fetch ${url} with axios: ${err?.message}`);
    return null;
  }
}

// ─── Extract only useful content from HTML (headings, code, tables) ───────────

export function extractUsefulContent(html: string): string {
  const $ = cheerio.load(html);
  const parts: string[] = [];

  // Títulos de seção
  $("h1, h2, h3").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length >= 3) parts.push("# " + text);
  });

  // Blocos de código — exemplos de request/response
  $("pre, code, .highlight, [class*='code']").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length >= 10) parts.push("```\n" + text + "\n```");
  });

  // Parâmetros em tabela
  $("table").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length >= 10) parts.push(text);
  });

  return parts.join("\n\n").substring(0, MAX_CHARS_PER_PAGE);
}

// ─── Main export ──────────────────────────────────────────────────────────────

// ─── Crawler recursivo ────────────────────────────────────────────────────────

async function crawlPages(
  startUrls: string[],
  fetchFn: (url: string) => Promise<{ html: string } | null>
): Promise<DocPage[]> {
  const pages: DocPage[] = [];
  const visited = new Set<string>();
  
  // fila: [url, profundidade, score]
  const queue: Array<[string, number, number]> = startUrls.map(url => [url, 0, 1]);

  while (queue.length > 0 && pages.length < MAX_PAGES) {
    // Fila: [url, depth, score]
    // Ordena por score (decrescente). Em caso de empate, por depth (crescente - Breadth First)
    queue.sort((a, b) => {
      if (b[2] !== a[2]) return b[2] - a[2];
      return a[1] - b[1];
    });
    const [url, depth, score] = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(`[DocFetcher] Crawling (depth ${depth}): ${url}`);

    const result = await fetchFn(url);
    if (!result) continue;

    const { title, text, links } = cleanHtml(result.html, url);
    if (text.length >= 100) {
      pages.push({ url, title, content: text });
    }

    if (depth < MAX_DEPTH) {
      for (const link of links) {
        if (!visited.has(link)) queue.push([link, depth + 1, 0]);
      }
    }
  }

  console.log(`[DocFetcher] Crawl finalizado: ${pages.length} páginas, ${visited.size} URLs visitadas`);
  return pages;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchDocumentation(docUrl: string, seedUrls?: string[]): Promise<FetchedDoc> {
  const cached = getCached(docUrl);
  if (cached) return cached;

  let rootHtml = "";
  let jsonLink: string | null = null;

  // 1. Playwright na página raiz
  let browser: any;
  try {
    console.log(`[DocFetcher] Launching Playwright for ${docUrl}...`);
    const wsEndpoint = process.env.BROWSERLESS_URL || (process.env.BROWSERLESS_TOKEN ? `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}` : "");
    if (wsEndpoint) {
      console.log(`[DocFetcher] Conectando via WebSocket no Browserless...`);
      browser = await chromium.connect({ wsEndpoint, timeout: 15000 });
      console.log('[DocFetcher] Browserless conectado, abrindo página...');
    } else {
      browser = await chromium.launch({ headless: true });
    }
    const page = await browser.newPage();
    
    await Promise.race([
      (async () => {
        try {
          await page.goto(docUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        } catch (gotoErr: any) {
          console.warn(`[DocFetcher] Timeout no domcontentloaded, tentando com 'load'... (${gotoErr.message})`);
          await page.goto(docUrl, { waitUntil: 'load', timeout: 15000 });
        }
        console.log('[DocFetcher] Página carregada, extraindo conteúdo...');
        rootHtml = await page.content();
        await page.waitForTimeout(1000);

        for (const loc of await page.locator("a").all()) {
          const href = await loc.getAttribute("href");
          if (href && (href.endsWith(".json") || href.includes(".json?"))) {
            jsonLink = new URL(href, docUrl).toString();
            break;
          }
        }
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Playwright hard timeout")), 45000))
    ]);

  } catch (e: any) {
    console.warn("[DocFetcher] Playwright falhou, caindo pro axios:", e.message);
    const fallback = await fetchPage(docUrl);
    if (fallback) rootHtml = fallback.html;
  } finally {
    if (browser) {
      await Promise.race([
        browser.close().catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
    }
  }

  if (!rootHtml) {
    return {
      mainUrl: docUrl, pages: [], combinedText: "",
      fetchedAt: new Date(), source: "fallback",
      error: `Não foi possível carregar ${docUrl}`,
    };
  }

  // 2. OpenAPI
  if (jsonLink) {
    console.log(`[DocFetcher] OpenAPI JSON encontrado! Baixando: ${jsonLink}`);
    const specResult = await fetchOpenApiSpec(jsonLink);
    if (specResult) {
      const { title, text } = cleanHtml(rootHtml, docUrl);
      const result: FetchedDoc = {
        mainUrl: docUrl,
        pages: [{ url: docUrl, title, content: text }],
        combinedText: text,
        fetchedAt: new Date(),
        source: "live",
        openapi: specResult,
      };
      docCache.set(docUrl, result);
      return result;
    }
  }

  // 3. Sem OpenAPI — crawl recursivo
  const fetchFn = async (url: string) => {
    if (url === docUrl && rootHtml) return { html: rootHtml };
    return fetchPage(url);
  };

  const pages = await crawlPages(seedUrls && seedUrls.length > 0 ? seedUrls : [docUrl], fetchFn);

  let combinedText = pages
    .map((p) => `### ${p.title}\nSource: ${p.url}\n\n${p.content}`)
    .join("\n\n---\n\n");

  if (combinedText.length > MAX_TOTAL_CHARS) {
    combinedText = combinedText.substring(0, MAX_TOTAL_CHARS) + "\n\n[...truncated for token limit]";
  }

  const result: FetchedDoc = {
    mainUrl: docUrl,
    pages,
    combinedText,
    fetchedAt: new Date(),
    source: "live",
  };

  docCache.set(docUrl, result);
  return result;
}

export function invalidateDocCache(docUrl: string): void {
  docCache.delete(docUrl);
}

export function getDocCacheStats(): { size: number; urls: string[] } {
  return {
    size: docCache.size,
    urls: Array.from(docCache.keys()),
  };
}
