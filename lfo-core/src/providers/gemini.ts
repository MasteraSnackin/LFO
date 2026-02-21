import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Tool as GeminiTool } from "@google/generative-ai";
import { CONFIG } from "../config.js";
import type { ChatMessage, ProviderResponse, Tool, FunctionCall } from "../types.js";

const genAI = new GoogleGenerativeAI(CONFIG.gemini.apiKey);

// ---------------------------------------------------------------------------
// Tool format conversion (LFO Tool → Gemini FunctionDeclaration)
// Mirrors hackathon's generate_cloud() pattern (main.py lines 52-68)
// ---------------------------------------------------------------------------
function convertToolsToGemini(tools?: Tool[]): GeminiTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const functionDeclarations = tools.map(t => {
    // Handle nested format (type=function) or flat format
    const toolDef = t.type === "function" && t.function ? t.function : t;
    const name = toolDef.name!;
    const description = toolDef.description!;
    const params = toolDef.parameters!;

    const properties: Record<string, { type: string; description?: string }> = {};
    for (const [key, value] of Object.entries(params.properties)) {
      properties[key] = {
        type: value.type.toUpperCase(),  // Gemini wants uppercase types
        description: value.description
      };
    }

    return {
      name,
      description,
      parameters: {
        type: "OBJECT",
        properties,
        required: params.required || []
      }
    };
  });

  // Cast to any to bypass Gemini SDK strict type checking
  return [{ functionDeclarations }] as any;
}

// ---------------------------------------------------------------------------
// Circuit breaker — trips on consecutive timeouts / rate-limit errors
// 401/403 are config errors and do NOT trip the breaker (won't self-heal)
// ---------------------------------------------------------------------------
const CB_FAILURE_THRESHOLD = 3;
const CB_RESET_TIMEOUT_MS  = 60_000;   // 60s — aligns with Gemini rate-limit windows

type GeminiCBState = "CLOSED" | "OPEN" | "HALF_OPEN";

let cbState: GeminiCBState = "CLOSED";
let cbFailures = 0;
let cbOpenedAt = 0;
let cbHalfOpenInFlight = false;

function cbAllow(): boolean {
  if (cbState === "CLOSED") return true;
  if (cbState === "OPEN") {
    if (Date.now() - cbOpenedAt >= CB_RESET_TIMEOUT_MS) {
      cbState = "HALF_OPEN";
      cbHalfOpenInFlight = true;
      console.log("[Gemini CB] HALF_OPEN — probing Gemini");
      return true;
    }
    return false;
  }
  // HALF_OPEN: only one probe at a time
  if (cbHalfOpenInFlight) return false;
  cbHalfOpenInFlight = true;
  return true;
}

function cbSuccess(): void {
  if (cbState !== "CLOSED") console.log("[Gemini CB] CLOSED — Gemini recovered");
  cbState = "CLOSED";
  cbFailures = 0;
  cbHalfOpenInFlight = false;
}

function cbFailure(tripworthy: boolean): void {
  cbHalfOpenInFlight = false;
  if (!tripworthy) return;
  cbFailures += 1;
  if (cbState === "HALF_OPEN" || cbFailures >= CB_FAILURE_THRESHOLD) {
    cbState = "OPEN";
    cbOpenedAt = Date.now();
    console.warn(`[Gemini CB] OPEN after ${cbFailures} failure(s). Will probe in ${CB_RESET_TIMEOUT_MS / 1000}s`);
  }
}

export function resetGeminiCircuitBreaker(): void {
  cbState = "CLOSED";
  cbFailures = 0;
  cbOpenedAt = 0;
  cbHalfOpenInFlight = false;
}

function buildModel(systemInstruction?: string) {
  return genAI.getGenerativeModel({
    model: CONFIG.gemini.model,
    ...(systemInstruction ? { systemInstruction } : {})
  });
}

function extractSystem(messages: ChatMessage[]): string | undefined {
  const parts = messages.filter(m => m.role === "system").map(m => m.content);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function toGeminiHistory(messages: ChatMessage[]) {
  // Exclude system messages (handled via systemInstruction) and the final user turn
  return messages
    .filter(m => m.role !== "system")
    .slice(0, -1)
    .map(m => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }]
    }));
}

function getLastUserMessage(messages: ChatMessage[]): string {
  const nonSystem = messages.filter(m => m.role !== "system");
  for (let i = nonSystem.length - 1; i >= 0; i--) {
    if (nonSystem[i].role === "user") return nonSystem[i].content;
  }
  return nonSystem[nonSystem.length - 1]?.content ?? "";
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    )
  ]);
}

async function fetchFromGemini(
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
  tools?: Tool[]
): Promise<ProviderResponse> {
  try {
    const systemInstruction = extractSystem(messages);
    const model = buildModel(systemInstruction);

    const geminiTools = convertToolsToGemini(tools);
    const chatConfig: any = {
      history: toGeminiHistory(messages),
      generationConfig: { maxOutputTokens: maxTokens, temperature }
    };
    if (geminiTools) {
      chatConfig.tools = geminiTools;
    }

    const chat = model.startChat(chatConfig);

    const result = await withTimeout(
      chat.sendMessage(getLastUserMessage(messages)),
      CONFIG.gemini.timeout,
      "Gemini"
    );

    // Parse response — can be text OR function calls
    const functionCalls: FunctionCall[] = [];
    let text = "";

    for (const candidate of result.response.candidates || []) {
      for (const part of candidate.content.parts) {
        if (part.functionCall) {
          functionCalls.push({
            name: part.functionCall.name,
            arguments: part.functionCall.args as Record<string, any>
          });
        } else if (part.text) {
          text += part.text;
        }
      }
    }

    // If no text and no function calls, error
    if (!text && functionCalls.length === 0) {
      throw new Error("Gemini returned empty response");
    }

    return {
      role: "assistant",
      content: text,
      function_calls: functionCalls.length > 0 ? functionCalls : undefined
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message.includes("timeout")) throw error;
      const sdkError = error as { status?: number };
      if (sdkError.status === 401) throw new Error("Gemini API key is invalid or revoked. Check GEMINI_API_KEY in .env");
      if (sdkError.status === 429) throw new Error("Gemini rate limit exceeded. Please try again later.");
      if (sdkError.status === 403) throw new Error("Gemini API quota exceeded. Check your API key and billing.");
      throw error;
    }
    throw new Error("Gemini unknown error");
  }
}

export async function callGemini(
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
  tools?: Tool[]
): Promise<ProviderResponse> {
  if (!cbAllow()) {
    const secs = Math.ceil((CB_RESET_TIMEOUT_MS - (Date.now() - cbOpenedAt)) / 1000);
    throw new Error(`Gemini circuit breaker open. Gemini appears unavailable. Will retry in ~${secs}s`);
  }

  try {
    const result = await fetchFromGemini(messages, maxTokens, temperature, tools);
    cbSuccess();
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "";
    // 401/403 are config errors — don't trip the breaker, they won't self-heal
    const tripworthy = !message.includes("invalid or revoked") && !message.includes("quota exceeded");
    cbFailure(tripworthy);
    throw error;
  }
}
