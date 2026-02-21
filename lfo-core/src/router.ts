import express, { Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";
import { callAndroidCactus, getCircuitState } from "./providers/android.js";
import { callGemini } from "./providers/gemini.js";
import { estimateTokens, resolveMode, determineTargetHybrid, evaluateConfidenceRouting } from "./routing.js";
import { recordRequest, getStats } from "./stats.js";
import type { ChatRequest, ChatResponse, ChatMessage, ErrorResponse, ProviderResponse, Tool } from "./types.js";

export interface Providers {
  android: (messages: ChatMessage[], maxTokens: number, temperature: number, tools?: Tool[]) => Promise<ProviderResponse>;
  gemini: (messages: ChatMessage[], maxTokens: number, temperature: number, tools?: Tool[]) => Promise<ProviderResponse>;
}

const defaultProviders: Providers = {
  android: callAndroidCactus,
  gemini: callGemini
};

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requiredToken = CONFIG.auth.token;
  if (!requiredToken) {
    next();
    return;
  }
  const authHeader = req.headers["authorization"];
  const provided = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  if (provided !== requiredToken) {
    const err: ErrorResponse = { error: { message: "Invalid or missing bearer token", type: "authentication_error" } };
    res.status(401).json(err);
    return;
  }
  next();
}

export function createApp(providers: Providers = defaultProviders) {
  const app = express();
  app.use(bodyParser.json({ limit: "2mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: Math.floor(Date.now() / 1000), version: "0.1.0" });
  });

  // ---------------------------------------------------------------------------
  // Dashboard routes (no auth — read-only, local-only)
  // ---------------------------------------------------------------------------

  app.get("/dashboard/api/stats", (_req: Request, res: Response) => {
    const stats = getStats();
    const lastCloudRecord = stats.recent.find(r => r.target === "cloud");
    const geminiLastStatus = lastCloudRecord
      ? (lastCloudRecord.status === 200 ? "ok" : "error")
      : "unknown";

    res.json({
      status: {
        uptime_ms: stats.uptime_ms,
        circuit_state: getCircuitState(),
        gemini_last_status: geminiLastStatus
      },
      totals: {
        requests: stats.total_requests,
        local: stats.total_local,
        cloud: stats.total_cloud,
        errors: stats.total_errors,
        avg_latency_local_ms: stats.avg_latency_local_ms,
        avg_latency_cloud_ms: stats.avg_latency_cloud_ms,
        circuit_trips: stats.circuit_trip_count
      },
      recent: stats.recent
    });
  });

  app.get("/dashboard", (_req: Request, res: Response) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    res.sendFile(path.resolve(__dirname, "..", "dashboard.html"));
  });

  // ---------------------------------------------------------------------------
  // OpenAI-compatible models list — prevents client "no models" startup errors
  // ---------------------------------------------------------------------------

  app.get("/v1/models", (_req: Request, res: Response) => {
    const created = Math.floor(Date.now() / 1000);
    res.json({
      object: "list",
      data: [
        { id: "lfo-local-functiongemma", object: "model", created, owned_by: "lfo" },
        { id: "lfo-gemini",              object: "model", created, owned_by: "lfo" }
      ]
    });
  });

  // ---------------------------------------------------------------------------
  // Main completion endpoint
  // ---------------------------------------------------------------------------

  app.post("/v1/chat/completions", authMiddleware, async (req: Request, res: Response) => {
    const startTime = Date.now();
    const body = req.body as ChatRequest;

    if (body.stream === true) {
      const error: ErrorResponse = {
        error: {
          message: "Streaming is not supported in LFO v0. Set stream: false or omit the field.",
          type: "not_implemented"
        }
      };
      res.status(501).json(error);
      return;
    }

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      const error: ErrorResponse = {
        error: {
          message: "messages field is required and must be a non-empty array",
          type: "invalid_request_error"
        }
      };
      res.status(400).json(error);
      return;
    }

    const invalidMessage = body.messages.find(
      (m) => typeof m.role !== "string" || typeof m.content !== "string"
    );
    if (invalidMessage) {
      const error: ErrorResponse = {
        error: {
          message: "Each message must have a string 'role' and string 'content' field",
          type: "invalid_request_error"
        }
      };
      res.status(400).json(error);
      return;
    }

    const messages = body.messages;
    const maxTokens = body.max_tokens ?? 512;
    const temperature = body.temperature ?? 0.7;
    const tools = body.tools;  // FunctionGemma tool calling
    const mode = resolveMode(body.metadata?.mode);
    const confidenceThreshold = body.metadata?.confidence_threshold ?? 0.7;
    const promptTokens = estimateTokens(messages);

    // Hybrid routing: check if we should skip local based on token count
    const initialRouting = determineTargetHybrid(messages, mode);

    console.log(
      `[${new Date().toISOString()}] POST /v1/chat/completions | tokens=${promptTokens} | mode=${mode} | tools=${tools?.length ?? 0} | initial_target=${initialRouting.target}`
    );

    try {
      let providerMessage: ProviderResponse;
      let finalTarget: "local" | "cloud";
      let routingReason: string;
      let localAttempted = false;

      if (initialRouting.skipLocal) {
        // Token count too high → skip local, go straight to cloud
        finalTarget = "cloud";
        routingReason = initialRouting.reason;
        providerMessage = await providers.gemini(messages, maxTokens, temperature, tools);
      } else if (initialRouting.target === "cloud") {
        // Explicit cloud mode
        finalTarget = "cloud";
        routingReason = initialRouting.reason;
        providerMessage = await providers.gemini(messages, maxTokens, temperature, tools);
      } else {
        // Try local first (mode=local or mode=auto with tokens within threshold)
        localAttempted = true;
        const localResult = await providers.android(messages, maxTokens, temperature, tools);

        // Evaluate confidence for possible cloud escalation
        const confidenceEval = evaluateConfidenceRouting(localResult, confidenceThreshold);

        if (confidenceEval.target === "cloud") {
          // Confidence too low or cloud_handoff → escalate to cloud
          console.log(
            `[${new Date().toISOString()}] Escalating to cloud | reason=${confidenceEval.reason} | confidence=${localResult.confidence?.toFixed(2) ?? "N/A"}`
          );
          finalTarget = "cloud";
          routingReason = confidenceEval.reason;
          providerMessage = await providers.gemini(messages, maxTokens, temperature, tools);
        } else {
          // Confidence acceptable → use local result
          finalTarget = "local";
          routingReason = confidenceEval.reason;
          providerMessage = localResult;
        }
      }

      const now = Math.floor(Date.now() / 1000);
      const latency = Date.now() - startTime;
      const completionTokens = Math.ceil(providerMessage.content.length / 4);
      console.log(
        `[${new Date().toISOString()}] Completed | target=${finalTarget} | reason=${routingReason} | latency=${latency}ms | status=200`
      );

      const response: ChatResponse = {
        id: `chatcmpl-${now}-${Math.random().toString(36).substring(2, 11)}`,
        object: "chat.completion",
        created: now,
        model: finalTarget === "local" ? "lfo-local-functiongemma" : "lfo-gemini",
        choices: [
          {
            index: 0,
            message: {
              ...providerMessage,
              function_calls: providerMessage.function_calls
            },
            finish_reason: "stop"
          }
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens
        },
        // Extended metadata for hybrid routing visibility
        lfo_metadata: {
          confidence: providerMessage.confidence,
          routing_reason: routingReason,
          local_attempt: localAttempted
        }
      };

      res.json(response);

      recordRequest({
        ts: new Date().toISOString(),
        mode,
        target: finalTarget,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        latency_ms: latency,
        status: 200,
        error: null
      });
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      const message = error instanceof Error ? error.message : "LFO routing error";
      console.error(
        `[${new Date().toISOString()}] Error | latency=${latency}ms | error=${message}`
      );

      let status = 502;
      let errorType = "lfo_provider_error";
      if (message.includes("timeout")) {
        status = 504;
        errorType = "lfo_timeout";
      } else if (message.includes("rate limit")) {
        status = 429;
        errorType = "rate_limit_exceeded";
      } else if (message.includes("quota")) {
        status = 403;
        errorType = "quota_exceeded";
      } else if (message.includes("Cannot reach") || message.includes("circuit")) {
        status = 503;
        errorType = "service_unavailable";
      } else if (message.includes("invalid or revoked")) {
        status = 401;
        errorType = "authentication_error";
      }

      // Determine target for error reporting (local vs cloud based on error message)
      const errorTarget: "local" | "cloud" =
        message.includes("Android") || message.includes("circuit breaker is open")
          ? "local"
          : message.includes("Gemini")
            ? "cloud"
            : "local";  // default to local

      const errorResponse: ErrorResponse = {
        error: {
          message,
          type: errorType,
          code: `${errorTarget}_error`
        }
      };

      res.status(status).json(errorResponse);

      recordRequest({
        ts: new Date().toISOString(),
        mode,
        target: errorTarget,
        prompt_tokens: promptTokens,
        completion_tokens: 0,
        latency_ms: latency,
        status,
        error: message
      });
    }
  });

  // Error middleware — must have 4 params for Express to treat it as an error handler.
  // Catches body-parser failures (e.g. 413 entity too large) before they surface as
  // raw Express responses without LFO's error shape.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    const bodyParserErr = err as { status?: number; type?: string };
    if (bodyParserErr.status === 413 || bodyParserErr.type === "entity.too.large") {
      const error: ErrorResponse = {
        error: {
          message: "Request body exceeds the 2mb limit",
          type: "invalid_request_error"
        }
      };
      res.status(413).json(error);
      return;
    }
    // Unexpected middleware error — surface as 500
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: { message, type: "internal_error" } });
  });

  return app;
}
