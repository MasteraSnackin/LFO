/**
 * Unit tests for pure routing functions (node:test, no external deps).
 * Run with: npm test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, resolveMode, determineTarget } from "../routing.js";
import type { ChatMessage } from "../types.js";

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------
describe("estimateTokens", () => {
  it("returns 0 for empty messages array", () => {
    assert.equal(estimateTokens([]), 0);
  });

  it("rounds up: 5 chars → 2 tokens", () => {
    const msgs: ChatMessage[] = [{ role: "user", content: "hello" }];
    assert.equal(estimateTokens(msgs), 2); // ceil(5/4) = 2
  });

  it("sums content across all messages", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hello" },       // 5
      { role: "assistant", content: "world!" }   // 6 (+ 1 space = 12 total)
    ];
    // join(" ") → "hello world!" = 12 chars, ceil(12/4) = 3
    assert.equal(estimateTokens(msgs), 3);
  });
});

// ---------------------------------------------------------------------------
// resolveMode
// ---------------------------------------------------------------------------
describe("resolveMode", () => {
  it("returns 'local' for 'local'", () => {
    assert.equal(resolveMode("local"), "local");
  });

  it("returns 'cloud' for 'cloud'", () => {
    assert.equal(resolveMode("cloud"), "cloud");
  });

  it("returns 'auto' for 'auto'", () => {
    assert.equal(resolveMode("auto"), "auto");
  });

  it("returns 'auto' for undefined", () => {
    assert.equal(resolveMode(undefined), "auto");
  });

  it("returns 'auto' for null", () => {
    assert.equal(resolveMode(null), "auto");
  });

  it("returns 'auto' for unknown string 'LOCAL'", () => {
    assert.equal(resolveMode("LOCAL"), "auto");
  });

  it("returns 'auto' for an arbitrary object", () => {
    assert.equal(resolveMode({ mode: "local" }), "auto");
  });
});

// ---------------------------------------------------------------------------
// determineTarget — uses CONFIG.routing.maxLocalTokens (default 1500)
// ---------------------------------------------------------------------------
describe("determineTarget", () => {
  const shortMsg: ChatMessage[] = [{ role: "user", content: "hi" }]; // 1 token
  const longContent = "a".repeat(6001); // ceil(6001/4) = 1501 → over default 1500
  const longMsg: ChatMessage[] = [{ role: "user", content: longContent }];

  it("mode=local always returns 'local'", () => {
    assert.equal(determineTarget(longMsg, "local"), "local");
  });

  it("mode=cloud always returns 'cloud'", () => {
    assert.equal(determineTarget(shortMsg, "cloud"), "cloud");
  });

  it("mode=auto + short message → 'local'", () => {
    assert.equal(determineTarget(shortMsg, "auto"), "local");
  });

  it("mode=auto + long message → 'cloud'", () => {
    assert.equal(determineTarget(longMsg, "auto"), "cloud");
  });
});
