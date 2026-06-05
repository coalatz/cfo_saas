/**
 * LLM Factory
 *
 * Instantiates LangChain chat models based on provider configuration.
 * Supports: openai, anthropic, manus (built-in Forge API via OpenAI-compatible endpoint)
 *
 * Model configs are stored in the DB (agent_model_configs table) and loaded
 * at pipeline runtime. Falls back to Manus built-in if no config is found.
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ENV } from "./_core/env";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModelProvider = "openai" | "anthropic" | "manus" | "gemini" | "groq";

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string; // only needed for openai/anthropic; manus uses built-in key
}

// ─── Default configs per agent ────────────────────────────────────────────────

export const DEFAULT_MODEL_CONFIGS: Record<string, ModelConfig> = {
  discovery: {
    provider: "manus",
    modelId: "llama-3.3-70b-versatile",
    temperature: 0.1,
    maxTokens: 4096,
  },
  mapping: {
    provider: "manus",
    modelId: "llama-3.3-70b-versatile",
    temperature: 0.1,
    maxTokens: 4096,
  },
  generator: {
    provider: "manus",
    modelId: "llama-3.3-70b-versatile",
    temperature: 0.2,
    maxTokens: 4096,
  },
  generator_mapper: {
    provider: "manus",
    modelId: "llama-3.3-70b-versatile",
    temperature: 0.2,
    maxTokens: 4096,
  },
  extractor: {
    provider: "manus",
    modelId: "llama-3.3-70b-versatile",
    temperature: 0.0,
    maxTokens: 2048,
  },
};


// ─── Available models catalog ─────────────────────────────────────────────────

export const AVAILABLE_MODELS: Record<ModelProvider, { id: string; label: string }[]> = {
  manus: [
    { id: "llama-3.3-70b-versatile",           label: "Llama 3.3 70B Versatile (recomendado)" },
    { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B" },
    { id: "qwen/qwen3-32b",                    label: "Qwen 3 32B" },
    { id: "groq/compound",                     label: "Groq Compound" },
    { id: "openai/gpt-oss-120b",               label: "GPT OSS 120B" },
    { id: "llama-3.1-8b-instant",              label: "Llama 3.1 8B Instant (rápido/barato)" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  ],
  anthropic: [
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
  ],
  gemini: [
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
    { id: "qwen/qwen3-32b", label: "Qwen 3 32B" },
  ],
};


// ─── Factory ──────────────────────────────────────────────────────────────────

export function createLLM(config: ModelConfig): BaseChatModel {
  const temperature = config.temperature ?? 0.1;
  const maxTokens = config.maxTokens ?? 2048;

  switch (config.provider) {
    case "openai": {
      const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OpenAI API key not configured. Add OPENAI_API_KEY via secrets.");
      return new ChatOpenAI({
        model: config.modelId,
        temperature,
        maxTokens,
        apiKey,
      });
    }

    case "anthropic": {
      const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("Anthropic API key not configured. Add ANTHROPIC_API_KEY via secrets.");
      return new ChatAnthropic({
        model: config.modelId,
        temperature,
        maxTokens,
        apiKey,
      });
    }

    case "groq": {
      const apiKey = config.apiKey || process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error("Groq API key não configurado. Adicione GROQ_API_KEY no .env.");
      return new ChatOpenAI({
        model: config.modelId,
        temperature,
        maxTokens,
        apiKey,
        configuration: {
          baseURL: "https://api.groq.com/openai/v1"
        }
      });
    }

    case "gemini": {
      const apiKey = config.apiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("Gemini API key não configurado. Adicione GEMINI_API_KEY no .env.");
      return new ChatOpenAI({
        model: config.modelId,
        temperature,
        maxTokens,
        apiKey,
        configuration: {
          baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
        }
      });
    }

    case "manus":
    default: {
      // Usa a chave passada pelo frontend (config.apiKey) OU do ambiente
      const apiKey = config.apiKey || ENV.forgeApiKey;

      const rawApiUrl = ENV.forgeApiUrl?.trim();
      if (rawApiUrl && apiKey) {
        const baseURL = rawApiUrl.endsWith("/v1")
          ? rawApiUrl
          : `${rawApiUrl.replace(/\/$/, "")}/v1`;

        // config.modelId vem do banco — usa se for explícito (não "default").
        // Se for "default", cai pro ENV.llmModel que pode estar configurado no ambiente de prod.
        // Último fallback: llama-3.3-70b-versatile (modelo válido confirmado no Manus).
        const modelName =
          (config.modelId && config.modelId !== "default")
            ? config.modelId
            : (ENV.llmModel || "llama-3.3-70b-versatile");

        return new ChatOpenAI({
          model: modelName,
          temperature,
          maxTokens,
          apiKey: apiKey.trim(),
          configuration: { baseURL },
        });
      }


      // Fallback local: Ollama
      const rawUrl = ENV.forgeApiUrl?.trim() || "http://localhost:11434";
      const baseUrl = rawUrl.replace(/\/v1\/?$/, "");

      return new ChatOllama({
        model: ENV.llmModel || "nemotron-3-super:cloud",
        temperature,
        baseUrl,
        numCtx: 32768,
      });
    }
  }
}

/**
 * Invoke a model with a simple prompt and return the text response.
 * Wraps LangChain invoke() with error handling.
 */
export async function invokeLLMWithConfig(
  config: ModelConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const llm = createLLM(config);
  const { HumanMessage, SystemMessage } = await import("@langchain/core/messages");

  let lastError;
  const maxRetries = 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);

      const content = response.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .filter((c): c is { type: "text"; text: string } => typeof c === "object" && c.type === "text")
          .map((c) => c.text)
          .join("");
      }
      return String(content);
    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || String(err);
      console.warn(`[LLM Error] Try ${i + 1}/${maxRetries} failed. Message: ${errMsg}`);
      if (err?.cause) console.warn(`[LLM Error Cause]:`, err.cause);
      
      const isRateLimit = errMsg.includes("429") || err?.response?.status === 429;
      const isNetworkError = errMsg.toLowerCase().includes("connection error") || 
                             errMsg.toLowerCase().includes("fetch failed") || 
                             errMsg.includes("ECONNRESET") || 
                             errMsg.includes("ETIMEDOUT");

      if (isRateLimit) {
        const waitTime = (i + 1) * 10000; // wait 10s, 20s, 30s
        console.warn(`[LLM Rate Limit] Limit reached. Retrying in ${waitTime / 1000}s...`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      
      if (isNetworkError) {
        const waitTime = 5000;
        console.warn(`[LLM Network Error] Retrying in ${waitTime / 1000}s...`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }

      // If it's a 400 or 401 or something else, it might be fatal, but let's log the full thing
      console.error("[LLM Fatal Error] Full error:", err);
      throw err; 
    }
  }
  throw lastError;
}

/**
 * Invoke a model and parse JSON from the response.
 * Strips markdown code fences if present.
 */
export async function invokeLLMJson<T = Record<string, unknown>>(
  config: ModelConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<T> {
  const raw = await invokeLLMWithConfig(config, systemPrompt, userPrompt);

  console.log("\n--- INÍCIO DA RESPOSTA DO LLM ---");
  console.log(raw);
  console.log("--- FIM DA RESPOSTA DO LLM ---\n");

  // Strip <think> tags (used by Qwen and other reasoning models)
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Strip markdown code fences
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to extract JSON object/array from the response
    const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
      return JSON.parse(match[1]) as T;
    }
    throw new Error(`LLM returned non-JSON response: ${cleaned.substring(0, 200)}`);
  }
}

export const invokeLLMText = invokeLLMWithConfig;
