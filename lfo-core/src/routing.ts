import { CONFIG } from "./config.js";
import type { ChatMessage } from "./types.js";

export type Mode = "auto" | "local" | "cloud";
export type RoutingStrategy = "token_count" | "confidence" | "hybrid";

const VALID_MODES = new Set<string>(["auto", "local", "cloud"]);

// Confidence threshold for hybrid routing (mirrors hackathon default)
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

export function estimateTokens(messages: ChatMessage[]): number {
  return Math.ceil(messages.map(m => m.content).join(" ").length / 4);
}

export function resolveMode(raw: unknown): Mode {
  if (typeof raw === "string" && VALID_MODES.has(raw)) {
    return raw as Mode;
  }
  return "auto";
}

/**
 * Original token-based routing strategy.
 * Routes based on estimated token count vs maxLocalTokens threshold.
 */
export function determineTarget(messages: ChatMessage[], mode: Mode): "local" | "cloud" {
  if (mode === "local") return "local";
  if (mode === "cloud") return "cloud";
  return estimateTokens(messages) <= CONFIG.routing.maxLocalTokens ? "local" : "cloud";
}

/**
 * Confidence-based routing strategy (mirrors FunctionGemma hackathon pattern).
 * First tries local; if confidence is below threshold, escalates to cloud.
 *
 * This is the "generate_hybrid" pattern from the hackathon repo:
 * - Always attempt local first
 * - Check model's self-assessed confidence
 * - If confidence < threshold, escalate to cloud
 * - If cloud_handoff flag is set, escalate immediately
 *
 * Returns: { target: "local" | "cloud", reason: string }
 */
export function evaluateConfidenceRouting(
  localResult?: {
    confidence?: number;
    cloud_handoff?: boolean;
  },
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD
): { target: "local" | "cloud"; reason: string } {
  if (!localResult) {
    // No local attempt yet → try local first
    return { target: "local", reason: "initial_attempt" };
  }

  // Check cloud handoff flag (model explicitly recommends cloud)
  if (localResult.cloud_handoff === true) {
    return { target: "cloud", reason: "cloud_handoff_flag" };
  }

  // Check confidence threshold
  const confidence = localResult.confidence ?? 0.5;
  if (confidence < confidenceThreshold) {
    return {
      target: "cloud",
      reason: `low_confidence_${confidence.toFixed(2)}_below_${confidenceThreshold}`
    };
  }

  // Confidence acceptable → use local result
  return { target: "local", reason: `high_confidence_${confidence.toFixed(2)}` };
}

/**
 * Hybrid routing strategy: combines token-count pre-filter with confidence-based fallback.
 *
 * Logic:
 * 1. If tokens > maxLocalTokens → skip local, go straight to cloud
 * 2. Otherwise, try local first, then evaluate confidence for possible cloud escalation
 *
 * This optimizes the hackathon pattern by avoiding local attempt for obviously large requests.
 */
export function determineTargetHybrid(
  messages: ChatMessage[],
  mode: Mode,
  localResult?: { confidence?: number; cloud_handoff?: boolean }
): { target: "local" | "cloud"; reason: string; skipLocal?: boolean } {
  // Respect explicit mode overrides
  if (mode === "local") return { target: "local", reason: "mode_override" };
  if (mode === "cloud") return { target: "cloud", reason: "mode_override" };

  // Token count pre-filter (optimization)
  const tokens = estimateTokens(messages);
  if (tokens > CONFIG.routing.maxLocalTokens) {
    return {
      target: "cloud",
      reason: `tokens_${tokens}_exceeds_${CONFIG.routing.maxLocalTokens}`,
      skipLocal: true
    };
  }

  // Tokens within range → evaluate confidence (if local was attempted)
  return evaluateConfidenceRouting(localResult);
}
