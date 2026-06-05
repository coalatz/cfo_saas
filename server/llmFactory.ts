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
    modelId: "default",
    temperature: 0.1,
    maxTokens: 1000,
  },
  mapping: {
    provider: "manus",
    modelId: "default",
    temperature: 0.1,
    maxTokens: 1000,
  },
  generator: {
    provider: "manus",
    modelId: "default",
    temperature: 0.2,
    maxTokens: 2000,
  },
  generator_mapper: {
    provider: "manus",
    modelId: "default",
    temperature: 0.2,
    maxTokens: 2000,
  },
  extractor: {
    provider: "manus",
    modelId: "default",
    temperature: 0.0,
    maxTokens: 1000,
  },
};

// ─── Available models catalog ─────────────────────────────────────────────────

export const AVAILABLE_MODELS: Record<ModelProvider, { id: string; label: string }[]> = {
  manus: [
    { id: "default", label: "Manus Default (recomendado)" },
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

        return new ChatOpenAI({
          model: ENV.llmModel || "gpt-4o",
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
      if (err?.message?.includes("429") || err?.response?.status === 429) {
        const waitTime = (i + 1) * 10000; // wait 10s, 20s, 30s
        console.warn(`[LLM Rate Limit] Limit reached. Retrying in ${waitTime / 1000}s...`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      throw err; // if it's not a 429, throw immediately
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
