/**
 * HTTP integration tests for the Express app (node:test, no external deps).
 * Uses mock providers — no real Android or Gemini connection needed.
 * Run with: npm test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../router.js";
import { CONFIG } from "../config.js";
import type { ChatMessage, ChatResponse, ErrorResponse, ProviderResponse } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(server: http.Server, path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const payload = JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port: addr.port, path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      res => {
        let raw = "";
        res.on("data", c => { raw += c; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }));
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function get(server: http.Server, path: string): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    http.get({ host: "127.0.0.1", port: addr.port, path }, res => {
      let raw = "";
      res.on("data", c => { raw += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }));
    }).on("error", reject);
  });
}

const mockLocal = async (): Promise<ProviderResponse> => ({
  role: "assistant",
  content: "local answer",
  confidence: 0.95  // High confidence for local success
});
const mockCloud = async (): Promise<ProviderResponse> => ({
  role: "assistant",
  content: "cloud answer"
});
const mockFail = async (): Promise<ProviderResponse> => { throw new Error("Cannot reach Android device at http://127.0.0.1:5555/completion. Verify IP and port in .env"); };
const mockTimeout = async (): Promise<ProviderResponse> => { throw new Error("Android timeout after 30000ms"); };
const mockRateLimit = async (): Promise<ProviderResponse> => { throw new Error("Gemini rate limit exceeded. Please try again later."); };
const mockGeminiAuth = async (): Promise<ProviderResponse> => { throw new Error("Gemini API key is invalid or revoked. Check GEMINI_API_KEY in .env"); };
const mockGeminiCB = async (): Promise<ProviderResponse> => { throw new Error("Gemini circuit breaker open. Gemini appears unavailable. Will retry in ~60s"); };

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  let server: http.Server;

  before(() => new Promise<void>(res => {
    server = createApp({ android: mockLocal, gemini: mockCloud }).listen(0, "127.0.0.1", res);
  }));
  after(() => new Promise<void>(res => server.close(() => res())));

  it("returns status ok", async () => {
    const { status, data } = await get(server, "/health");
    assert.equal(status, 200);
    assert.equal((data as { status: string }).status, "ok");
  });
});

describe("POST /v1/chat/completions — validation", () => {
  let server: http.Server;

  before(() => new Promise<void>(res => {
    server = createApp({ android: mockLocal, gemini: mockCloud }).listen(0, "127.0.0.1", res);
  }));
  after(() => new Promise<void>(res => server.close(() => res())));

  it("returns 400 when messages is missing", async () => {
    const { status, data } = await post(server, "/v1/chat/completions", {});
    assert.equal(status, 400);
    assert.equal((data as ErrorResponse).error.type, "invalid_request_error");
  });

  it("returns 400 when messages is empty array", async () => {
    const { status } = await post(server, "/v1/chat/completions", { messages: [] });
    assert.equal(status, 400);
  });

  it("returns 400 when messages is not an array", async () => {
    const { status } = await post(server, "/v1/chat/completions", { messages: "hello" });
    assert.equal(status, 400);
  });

  it("returns 400 when a message is missing role", async () => {
    const { status, data } = await post(server, "/v1/chat/completions", {
      messages: [{ content: "hi" }]
    });
    assert.equal(status, 400);
    assert.equal((data as ErrorResponse).error.type, "invalid_request_error");
  });

  it("returns 400 when a message is missing content", async () => {
    const { status } = await post(server, "/v1/chat/completions", {
      messages: [{ role: "user" }]
    });
    assert.equal(status, 400);
  });

  it("returns 501 when stream is true", async () => {
    const { status, data } = await post(server, "/v1/chat/completions", {
      messages: [{ role: "user", content: "hi" }],
      stream: true
    });
    assert.equal(status, 501);
    assert.equal((data as ErrorResponse).error.type, "not_implemented");
  });

  it("returns 413 when body exceeds 2mb limit", async () => {
    // Send a raw oversized body directly — bypass the JSON.stringify helper
    const addr = server.address() as { port: number };
    const bigPayload = "x".repeat(3 * 1024 * 1024); // 3MB string
    const body = JSON.stringify({ messages: [{ role: "user", content: bigPayload }] });
    const { status, data } = await new Promise<{ status: number; data: unknown }>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: addr.port, path: "/v1/chat/completions", method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
        res => {
          let raw = "";
          res.on("data", c => { raw += c; });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }));
        }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
    assert.equal(status, 413);
    assert.equal((data as ErrorResponse).error.type, "invalid_request_error");
  });
});

describe("POST /v1/chat/completions — routing", () => {
  let server: http.Server;

  before(() => new Promise<void>(res => {
    server = createApp({ android: mockLocal, gemini: mockCloud }).listen(0, "127.0.0.1", res);
  }));
  after(() => new Promise<void>(res => server.close(() => res())));

  const userMsg: ChatMessage[] = [{ role: "user", content: "hi" }];

  it("mode=local routes to android mock", async () => {
    const { status, data } = await post(server, "/v1/chat/completions", {
      messages: userMsg,
      metadata: { mode: "local" }
    });
    assert.equal(status, 200);
    const r = data as ChatResponse;
    assert.equal(r.choices[0].message.content, "local answer");
    assert.equal(r.model, "lfo-local-functiongemma");
  });

  it("mode=cloud routes to gemini mock", async () => {
    const { status, data } = await post(server, "/v1/chat/completions", {
      messages: userMsg,
      metadata: { mode: "cloud" }
    });
    assert.equal(status, 200);
    const r = data as ChatResponse;
    assert.equal(r.choices[0].message.content, "cloud answer");
    assert.equal(r.model, "lfo-gemini");
  });

  it("invalid mode falls back to auto (short message → local)", async () => {
    const { status, data } = await post(server, "/v1/chat/completions", {
      messages: userMsg,
      metadata: { mode: "INVALID" }
    });
    assert.equal(status, 200);
    assert.equal((data as ChatResponse).choices[0].message.content, "local answer");
  });

  it("response includes usage object", async () => {
    const { data } = await post(server, "/v1/chat/completions", {
      messages: userMsg,
      metadata: { mode: "cloud" }
    });
    const r = data as ChatResponse;
    assert.ok(typeof r.usage.prompt_tokens === "number");
    assert.ok(typeof r.usage.completion_tokens === "number");
    assert.equal(r.usage.total_tokens, r.usage.prompt_tokens + r.usage.completion_tokens);
  });
});

describe("POST /v1/chat/completions — error handling", () => {
  let server: http.Server;

  before(() => new Promise<void>(res => {
    server = createApp({ android: mockFail, gemini: mockRateLimit }).listen(0, "127.0.0.1", res);
  }));
  after(() => new Promise<void>(res => server.close(() => res())));

  const userMsg: ChatMessage[] = [{ role: "user", content: "hi" }];

  it("Android unreachable → 503 service_unavailable", async () => {
    const { status, data } = await post(server, "/v1/chat/completions", {
      messages: userMsg,
      metadata: { mode: "local" }
    });
    assert.equal(status, 503);
    assert.equal((data as ErrorResponse).error.type, "service_unavailable");
  });

  it("Gemini rate limit → 429 rate_limit_exceeded", async () => {
    const { status, data } = await post(server, "/v1/chat/completions", {
      messages: userMsg,
      metadata: { mode: "cloud" }
    });
    assert.equal(status, 429);
    assert.equal((data as ErrorResponse).error.type, "rate_limit_exceeded");
  });
});

describe("POST /v1/chat/completions — timeout error", () => {
  let server: http.Server;

  before(() => new Promise<void>(res => {
    server = createApp({ android: mockTimeout, gemini: mockCloud }).listen(0, "127.0.0.1", res);
  }));
  after(() => new Promise<void>(res => server.close(() => res())));

  it("provider timeout → 504 lfo_timeout", async () => {
    const { status, data } = await post(server, "/v1/chat/completions", {
      messages: [{ role: "user", content: "hi" }],
      metadata: { mode: "local" }
    });
    assert.equal(status, 504);
    assert.equal((data as ErrorResponse).error.type, "lfo_timeout");
  });
});

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function postWithAuth(
  server: http.Server,
  path: string,
  body: unknown,
  token?: string
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const payload = JSON.stringify(body);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(payload))
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const req = http.request(
      { host: "127.0.0.1", port: addr.port, path, method: "POST", headers },
      res => {
        let raw = "";
        res.on("data", c => { raw += c; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }));
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("Auth middleware", () => {
  let server: http.Server;
  const validToken = "test-secret-token";

  before(() => new Promise<void>(res => {
    // Mutate the already-loaded CONFIG singleton for this test scope
    CONFIG.auth.token = validToken;
    server = createApp({ android: mockLocal, gemini: mockCloud }).listen(0, "127.0.0.1", res);
  }));
  after(() => new Promise<void>(res => {
    CONFIG.auth.token = undefined;
    server.close(() => res());
  }));

  const body = { messages: [{ role: "user", content: "hi" }], metadata: { mode: "cloud" } };

  it("/health is always accessible without token", async () => {
    const { status } = await get(server, "/health");
    assert.equal(status, 200);
  });

  it("valid token → 200", async () => {
    const { status } = await postWithAuth(server, "/v1/chat/completions", body, validToken);
    assert.equal(status, 200);
  });

  it("missing token → 401 authentication_error", async () => {
    const { status, data } = await postWithAuth(server, "/v1/chat/completions", body);
    assert.equal(status, 401);
    assert.equal((data as ErrorResponse).error.type, "authentication_error");
  });

  it("wrong token → 401 authentication_error", async () => {
    const { status, data } = await postWithAuth(server, "/v1/chat/completions", body, "wrong-token");
    assert.equal(status, 401);
    assert.equal((data as ErrorResponse).error.type, "authentication_error");
  });
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

describe("GET /dashboard/api/stats", () => {
  let server: http.Server;

  before(() => new Promise<void>(res => {
    server = createApp({ android: mockLocal, gemini: mockCloud }).listen(0, "127.0.0.1", res);
  }));
  after(() => new Promise<void>(res => server.close(() => res())));

  it("returns 200 with expected shape before any requests", async () => {
    const { status, data } = await get(server, "/dashboard/api/stats");
    assert.equal(status, 200);
    const d = data as Record<string, unknown>;
    assert.ok(d.status, "has status");
    assert.ok(d.totals, "has totals");
    assert.ok(Array.isArray(d.recent), "recent is array");
  });

  it("totals increment after a successful request", async () => {
    const before = (await get(server, "/dashboard/api/stats")).data as { totals: { requests: number } };
    const beforeCount = before.totals.requests;

    await post(server, "/v1/chat/completions", {
      messages: [{ role: "user", content: "hi" }],
      metadata: { mode: "cloud" }
    });

    const after = (await get(server, "/dashboard/api/stats")).data as { totals: { requests: number; cloud: number } };
    assert.equal(after.totals.requests, beforeCount + 1);
    assert.ok(after.totals.cloud > 0, "cloud count incremented");
  });

  it("recent contains the last request", async () => {
    await post(server, "/v1/chat/completions", {
      messages: [{ role: "user", content: "test recent" }],
      metadata: { mode: "cloud" }
    });

    const { data } = await get(server, "/dashboard/api/stats");
    const d = data as { recent: Array<{ target: string; status: number; error: null }> };
    assert.ok(d.recent.length > 0, "recent has entries");
    assert.equal(d.recent[0].status, 200);
    assert.equal(d.recent[0].error, null);
  });

  it("error requests appear in recent with non-200 status", async () => {
    const failServer = createApp({ android: mockFail, gemini: mockCloud });
    const s = await new Promise<http.Server>(res => {
      const srv = failServer.listen(0, "127.0.0.1", () => res(srv));
    });

    await post(s, "/v1/chat/completions", {
      messages: [{ role: "user", content: "fail" }],
      metadata: { mode: "local" }
    });

    const { data } = await get(s, "/dashboard/api/stats");
    const d = data as { recent: Array<{ status: number; error: string | null }> };
    assert.ok(d.recent.length > 0);
    assert.ok(d.recent[0].status >= 400, "error status recorded");
    assert.ok(d.recent[0].error !== null, "error message recorded");

    await new Promise<void>(res => s.close(() => res()));
  });

  it("status object has circuit_state and uptime_ms", async () => {
    const { data } = await get(server, "/dashboard/api/stats");
    const d = data as { status: { circuit_state: string; uptime_ms: number; gemini_last_status: string } };
    assert.ok(typeof d.status.circuit_state === "string", "circuit_state is string");
    assert.ok(typeof d.status.uptime_ms === "number", "uptime_ms is number");
    assert.ok(d.status.uptime_ms >= 0, "uptime_ms is non-negative");
    assert.ok(typeof d.status.gemini_last_status === "string", "gemini_last_status is string");
  });
});

// ---------------------------------------------------------------------------
// GET /v1/models
// ---------------------------------------------------------------------------

describe("GET /v1/models", () => {
  let server: http.Server;

  before(() => new Promise<void>(res => {
    server = createApp({ android: mockLocal, gemini: mockCloud }).listen(0, "127.0.0.1", res);
  }));
  after(() => new Promise<void>(res => server.close(() => res())));

  it("returns 200 with OpenAI-compatible model list", async () => {
    const { status, data } = await get(server, "/v1/models");
    assert.equal(status, 200);
    const d = data as { object: string; data: Array<{ id: string; object: string; owned_by: string }> };
    assert.equal(d.object, "list");
    assert.ok(Array.isArray(d.data), "data is array");
    assert.ok(d.data.length >= 2, "at least 2 models listed");
    assert.ok(d.data.every(m => m.object === "model" && typeof m.id === "string"), "each entry has id and object");
  });
});

// ---------------------------------------------------------------------------
// Error mapping — Gemini 401 and circuit breaker
// ---------------------------------------------------------------------------

describe("POST /v1/chat/completions — Gemini error mapping", () => {
  const userMsg = [{ role: "user", content: "hi" }];

  it("Gemini invalid API key → 401 authentication_error", async () => {
    const s = await new Promise<http.Server>(res => {
      const srv = createApp({ android: mockLocal, gemini: mockGeminiAuth }).listen(0, "127.0.0.1", () => res(srv));
    });
    const { status, data } = await post(s, "/v1/chat/completions", { messages: userMsg, metadata: { mode: "cloud" } });
    await new Promise<void>(res => s.close(() => res()));
    assert.equal(status, 401);
    assert.equal((data as ErrorResponse).error.type, "authentication_error");
  });

  it("Gemini circuit breaker open → 503 service_unavailable", async () => {
    const s = await new Promise<http.Server>(res => {
      const srv = createApp({ android: mockLocal, gemini: mockGeminiCB }).listen(0, "127.0.0.1", () => res(srv));
    });
    const { status, data } = await post(s, "/v1/chat/completions", { messages: userMsg, metadata: { mode: "cloud" } });
    await new Promise<void>(res => s.close(() => res()));
    assert.equal(status, 503);
    assert.equal((data as ErrorResponse).error.type, "service_unavailable");
  });
});
