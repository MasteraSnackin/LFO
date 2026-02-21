/**
 * Circuit breaker tests for the Android provider.
 * Uses mocked fetch — no real network connection needed.
 * Run with: npm test
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetCircuitBreaker, callAndroidCactus } from "../providers/android.js";
import type { ChatMessage } from "../types.js";

// ---------------------------------------------------------------------------
// Patch node-fetch for tests — replace with a controllable stub
// ---------------------------------------------------------------------------

// We can't easily mock ES modules without a framework, so we test the
// circuit breaker logic directly by observing state transitions through
// repeated calls that ECONNREFUSED (which the android provider converts to
// a meaningful error). We force failures by having CONFIG point to an
// unreachable port.
//
// CONFIG is already loaded with ANDROID_HOST=127.0.0.1, ANDROID_PORT=5555
// from .env.test. Since nothing is listening there, every call will fail
// with ECONNREFUSED immediately — perfect for circuit breaker testing.

const MESSAGES: ChatMessage[] = [{ role: "user", content: "test" }];

// Helper: call and swallow error, return error message
async function tryCall(): Promise<string> {
  try {
    await callAndroidCactus(MESSAGES, 64, 0.7);
    return "ok";
  } catch (e: unknown) {
    return e instanceof Error ? e.message : "unknown";
  }
}

describe("Android circuit breaker", () => {
  beforeEach(() => {
    resetCircuitBreaker();
  });

  it("first call fails with ECONNREFUSED (circuit CLOSED)", async () => {
    const msg = await tryCall();
    assert.ok(msg.includes("Cannot reach") || msg.includes("ECONNREFUSED"), `got: ${msg}`);
  });

  it("after 3 failures circuit opens and returns fast-fail message", async () => {
    // Three failures to trip the breaker
    await tryCall();
    await tryCall();
    await tryCall();

    // Fourth call should be a fast-fail from open circuit
    const msg = await tryCall();
    assert.ok(
      msg.includes("circuit breaker is open"),
      `Expected circuit open message, got: ${msg}`
    );
  });

  it("circuit fast-fail returns before timeout (no network call)", async () => {
    // Trip the breaker
    await tryCall();
    await tryCall();
    await tryCall();

    const start = Date.now();
    await tryCall();
    const elapsed = Date.now() - start;

    // Fast-fail should be nearly instant (< 50ms), not wait for network timeout
    assert.ok(elapsed < 50, `Circuit fast-fail took ${elapsed}ms — expected < 50ms`);
  });

  it("resetCircuitBreaker re-allows calls", async () => {
    // Trip the breaker
    await tryCall();
    await tryCall();
    await tryCall();

    // Reset
    resetCircuitBreaker();

    // Next call should attempt network again (will fail with ECONNREFUSED, not circuit message)
    const msg = await tryCall();
    assert.ok(
      msg.includes("Cannot reach") || msg.includes("ECONNREFUSED"),
      `Expected network error after reset, got: ${msg}`
    );
  });
});