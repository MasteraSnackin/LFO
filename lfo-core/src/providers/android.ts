import { CONFIG } from "../config.js";
import { incrementCircuitTrips } from "../stats.js";
import type { ChatMessage, ProviderResponse } from "../types.js";

interface AndroidResponse {
  text?: string;
  error?: string;
  // Enhanced FunctionGemma response fields
  function_calls?: Array<{ name: string; arguments: Record<string, any> }>;
  confidence?: number;
  total_time_ms?: number;
  cloud_handoff?: boolean;
}

// ---------------------------------------------------------------------------
// Circuit breaker (in-process, single Android device)
// ---------------------------------------------------------------------------
const FAILURE_THRESHOLD = 3;       // consecutive failures before opening
const RESET_TIMEOUT_MS = 30_000;   // ms in OPEN state before probing

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

let circuitState: CircuitState = "CLOSED";
let consecutiveFailures = 0;
let openedAt = 0;
let halfOpenProbeInFlight = false;  // prevents concurrent probes in HALF_OPEN

function circuitAllow(): boolean {
  if (circuitState === "CLOSED") return true;
  if (circuitState === "OPEN") {
    if (Date.now() - openedAt >= RESET_TIMEOUT_MS) {
      circuitState = "HALF_OPEN";
      halfOpenProbeInFlight = true;
      console.log("[Android CB] HALF_OPEN — probing device");
      return true;
    }
    return false;
  }
  // HALF_OPEN: only one probe at a time
  if (halfOpenProbeInFlight) return false;
  halfOpenProbeInFlight = true;
  return true;
}

function circuitOnSuccess(): void {
  if (circuitState !== "CLOSED") {
    console.log("[Android CB] CLOSED — device recovered");
  }
  circuitState = "CLOSED";
  consecutiveFailures = 0;
  halfOpenProbeInFlight = false;
}

function circuitOnFailure(): void {
  halfOpenProbeInFlight = false;
  consecutiveFailures += 1;
  if (circuitState === "HALF_OPEN" || consecutiveFailures >= FAILURE_THRESHOLD) {
    circuitState = "OPEN";
    openedAt = Date.now();
    incrementCircuitTrips();
    console.warn(
      `[Android CB] OPEN after ${consecutiveFailures} failure(s). Will probe in ${RESET_TIMEOUT_MS / 1000}s`
    );
  }
}

// Exported so tests can reset state between runs
export function resetCircuitBreaker(): void {
  circuitState = "CLOSED";
  consecutiveFailures = 0;
  openedAt = 0;
  halfOpenProbeInFlight = false;
}

// Exported for dashboard status display
export function getCircuitState(): CircuitState {
  return circuitState;
}

// ---------------------------------------------------------------------------
// HTTP call
// ---------------------------------------------------------------------------
async function fetchFromAndroid(
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
  tools?: any[]  // Tool definitions from types.ts
): Promise<ProviderResponse> {
  const url = `http://${CONFIG.android.host}:${CONFIG.android.port}/completion`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.android.timeout);

  try {
    const body: any = { messages, max_tokens: maxTokens, temperature };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Android HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as AndroidResponse;

    if (data.error) {
      throw new Error(`Android error: ${data.error}`);
    }

    // FunctionGemma can return either text OR function_calls
    const hasText = Boolean(data.text);
    const hasFunctionCalls = data.function_calls && data.function_calls.length > 0;

    if (!hasText && !hasFunctionCalls) {
      throw new Error("Android response missing both text and function_calls");
    }

    // Return enhanced response with FunctionGemma metadata
    return {
      role: "assistant",
      content: data.text || "",
      function_calls: data.function_calls,
      confidence: data.confidence,
      cloud_handoff: data.cloud_handoff,
      total_time_ms: data.total_time_ms
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error) {
      // globalThis.fetch wraps low-level errors in a TypeError with a `cause`
      const cause = (error as { cause?: Error & { code?: string } }).cause;
      if (error.name === "AbortError" || cause?.name === "AbortError") {
        throw new Error(`Android timeout after ${CONFIG.android.timeout}ms. Check device connectivity.`);
      }
      const nodeError = error as { code?: string };
      if (nodeError.code === "ECONNREFUSED" || cause?.code === "ECONNREFUSED") {
        throw new Error(`Cannot reach Android device at ${url}. Verify IP and port in .env`);
      }
      throw error;
    }
    throw new Error("Android unknown error");
  }
}

// ---------------------------------------------------------------------------
// Public entry point — circuit breaker wraps the HTTP call
// ---------------------------------------------------------------------------
export async function callAndroidCactus(
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
  tools?: any[]  // Optional FunctionGemma tools
): Promise<ProviderResponse> {
  if (!circuitAllow()) {
    const secs = Math.ceil((RESET_TIMEOUT_MS - (Date.now() - openedAt)) / 1000);
    throw new Error(
      `Android circuit breaker is open. Device assumed offline. Will retry in ~${secs}s`
    );
  }

  try {
    const result = await fetchFromAndroid(messages, maxTokens, temperature, tools);
    circuitOnSuccess();
    return result;
  } catch (error: unknown) {
    circuitOnFailure();
    throw error;
  }
}
