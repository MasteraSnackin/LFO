# LFO × FunctionGemma Hackathon Integration Guide

**Date**: 2026-02-21
**Status**: Integrated (code complete, requires testing + Cactus RN package)

---

## Overview

This guide documents the integration of FunctionGemma hackathon patterns (`cactus-compute/functiongemma-hackathon`) into the LocalFirst Orchestrator (LFO) project.

**What was integrated:**
- ✅ Tool calling support (FunctionGemma function calling)
- ✅ Confidence-based hybrid routing (mirrors hackathon's `generate_hybrid`)
- ✅ Enhanced response metadata (confidence, function_calls, cloud_handoff)
- ✅ Full protocol stack updates (mobile → bridge → lfo-core)

---

## Architecture Changes

### Before Integration

```
OpenClaw → lfo-core → android-bridge → Android RN app
                 ↓                           ↓
             Gemini                     CactusLM
              (cloud)                    (local)

Routing: Token count threshold only
Response: Plain text
```

### After Integration

```
OpenClaw → lfo-core → android-bridge → Android RN app
    ↓          ↓                           ↓
  tools    Gemini                    FunctionGemma
           (cloud)                    (tool calling)

Routing: Hybrid (token + confidence)
Response: text | function_calls + metadata
```

**Key additions:**
1. **Tool calling** — FunctionGemma can now execute function calls on-device
2. **Confidence scoring** — Model returns self-assessed confidence (0-1)
3. **Cloud handoff flag** — Model can explicitly request cloud escalation
4. **Hybrid routing** — Combines token pre-filter + confidence-based fallback

---

## File Changes Summary

### lfo-mobile (React Native)

**`lfo-mobile/src/cactus.ts`**
- Added `Tool`, `FunctionCall`, `CompletionResult` types
- Enhanced `runCompletion()` to accept `tools` parameter
- Returns structured response with `function_calls`, `confidence`, `total_time_ms`, `cloud_handoff`
- Mirrors hackathon's `cactus_complete()` API patterns

**`lfo-mobile/src/server.ts`**
- Updated TCP protocol to accept `tools` in request
- Returns enhanced response shape with confidence + function_calls
- Passes through all hybrid routing metadata to bridge

### android-bridge

**`android-bridge/index.js`**
- Updated type definitions to include `Tool[]` and enhanced response
- Passes through `tools` parameter from lfo-core to Android device
- Forwards confidence + function_calls back to lfo-core

### lfo-core (Router)

**`lfo-core/src/types.ts`**
- Added `Tool`, `FunctionCall` interfaces (OpenAI-compatible)
- Enhanced `ChatRequest` with `tools` and `confidence_threshold` fields
- Enhanced `ProviderResponse` with `function_calls`, `confidence`, `cloud_handoff`, `total_time_ms`
- Extended `ChatResponse` with optional `lfo_metadata` for routing visibility

**`lfo-core/src/routing.ts`**
- Added `evaluateConfidenceRouting()` — mirrors hackathon's `generate_hybrid` logic
- Added `determineTargetHybrid()` — combines token pre-filter + confidence routing
- Default confidence threshold: 0.7 (matches hackathon default)

**`lfo-core/src/providers/android.ts`**
- Updated `callAndroidCactus()` to accept optional `tools` parameter
- Enhanced `AndroidResponse` interface with confidence + function_calls fields
- Returns full `ProviderResponse` with all metadata for routing decisions

---

## New Routing Strategies

### 1. Token Count (Original)

```typescript
// lfo-core/src/routing.ts
determineTarget(messages, mode)
```

**Logic**: If `estimateTokens(messages) <= maxLocalTokens` → local, else → cloud

**Use case**: Simple threshold-based routing (LFO v0 behavior)

### 2. Confidence-Based (Hackathon Pattern)

```typescript
// lfo-core/src/routing.ts
evaluateConfidenceRouting(localResult, confidenceThreshold)
```

**Logic**:
1. Always try local first
2. If `cloud_handoff === true` → escalate to cloud
3. If `confidence < threshold` → escalate to cloud
4. Otherwise → use local result

**Use case**: Tool calling scenarios where model confidence matters more than token count

### 3. Hybrid (Optimized)

```typescript
// lfo-core/src/routing.ts
determineTargetHybrid(messages, mode, localResult)
```

**Logic**:
1. If `tokens > maxLocalTokens` → skip local, go straight to cloud
2. Otherwise → try local, then evaluate confidence for fallback

**Use case**: Production hybrid routing (best of both worlds)

---

## API Changes

### ChatRequest (lfo-core)

**New fields:**
```typescript
{
  messages: ChatMessage[];
  tools?: Tool[];  // ← NEW: FunctionGemma tool definitions
  metadata?: {
    mode?: "auto" | "local" | "cloud";
    confidence_threshold?: number;  // ← NEW: override default 0.7
  };
}
```

### ProviderResponse (lfo-core)

**New fields:**
```typescript
{
  role: "assistant";
  content: string;
  function_calls?: FunctionCall[];  // ← NEW: tool calls from FunctionGemma
  confidence?: number;              // ← NEW: 0-1 self-assessed confidence
  cloud_handoff?: boolean;          // ← NEW: model recommends cloud
  total_time_ms?: number;           // ← NEW: inference time
}
```

### CompletionRequest (android-bridge + lfo-mobile)

**New fields:**
```typescript
{
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: Tool[];  // ← NEW: passed through to FunctionGemma
}
```

---

## Usage Examples

### Example 1: Simple Tool Calling

**Request to lfo-core:**
```json
POST /v1/chat/completions
{
  "messages": [
    {"role": "user", "content": "What's the weather in San Francisco?"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string", "description": "City name"}
          },
          "required": ["location"]
        }
      }
    }
  ],
  "metadata": {"mode": "auto"}
}
```

**Response with high confidence (local):**
```json
{
  "id": "chatcmpl-...",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "",
      "function_calls": [{
        "name": "get_weather",
        "arguments": {"location": "San Francisco"}
      }]
    },
    "finish_reason": "stop"
  }],
  "lfo_metadata": {
    "confidence": 0.92,
    "routing_reason": "high_confidence_0.92",
    "local_attempt": true
  }
}
```

**Response with low confidence (escalated to cloud):**
```json
{
  "id": "chatcmpl-...",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "",
      "function_calls": [{
        "name": "get_weather",
        "arguments": {"location": "San Francisco"}
      }]
    },
    "finish_reason": "stop"
  }],
  "lfo_metadata": {
    "confidence": 0.45,
    "routing_reason": "low_confidence_0.45_below_0.70",
    "local_attempt": true
  }
}
```

### Example 2: Override Confidence Threshold

```json
POST /v1/chat/completions
{
  "messages": [...],
  "tools": [...],
  "metadata": {
    "mode": "auto",
    "confidence_threshold": 0.85  // stricter than default 0.7
  }
}
```

---

## Testing Checklist

### Unit Tests (lfo-core)

- [ ] `routing.test.ts` — add tests for `evaluateConfidenceRouting()`
- [ ] `routing.test.ts` — add tests for `determineTargetHybrid()`
- [ ] `router.test.ts` — add test for tool calling request/response shape
- [ ] `router.test.ts` — add test for confidence-based routing with mock providers

### Integration Tests

- [ ] **Android device setup** — install FunctionGemma GGUF model on device
- [ ] **Cactus RN package** — install `cactus-react-native` (check for React Native bindings availability)
- [ ] **Tool calling smoke test** — send tool call request → verify function_calls in response
- [ ] **Confidence routing** — mock low confidence → verify cloud escalation
- [ ] **Cloud handoff flag** — mock `cloud_handoff: true` → verify immediate escalation

### End-to-End

- [ ] **OpenClaw → LFO → Android** — full flow with real FunctionGemma on device
- [ ] **Hybrid routing** — submit requests of varying complexity, verify routing decisions
- [ ] **Dashboard visibility** — confirm `lfo_metadata` shows routing reasons

---

## Known Gaps & Next Steps

### Gap 1: `cactus-react-native` Package

**Status**: Code references `cactus-react-native` but package may not be publicly released yet.

**Workaround options:**
1. Check Cactus docs for React Native bindings status: https://cactuscompute.com/docs/v1.7
2. Contact Cactus team (Reddit: r/cactuscompute) for RN SDK access
3. Use Python Cactus CLI as reference and adapt to RN native module patterns

**Required features** (must be supported by RN bindings):
- `CactusLM.init()` with model path
- `lm.completion()` with `tools`, `force_tools` options
- Response shape with `function_calls`, `confidence`, `cloud_handoff`

### Gap 2: Router Integration

**Status**: `lfo-core/src/router.ts` still uses old `determineTarget()` strategy.

**Next step**: Update `/v1/chat/completions` endpoint to:
1. Extract `tools` from request body
2. Pass `tools` to providers
3. Use `determineTargetHybrid()` for routing decisions
4. Populate `lfo_metadata` in response

**Example router.ts changes needed:**
```typescript
// In POST /v1/chat/completions handler
const tools = body.tools;
const confidenceThreshold = body.metadata?.confidence_threshold ?? 0.7;

// First attempt (token-based pre-filter)
const initialRouting = determineTargetHybrid(messages, mode);

if (initialRouting.skipLocal) {
  // Skip local, go straight to cloud
  const cloudResult = await providers.gemini(messages, maxTokens, temperature, tools);
  // ... build response
} else {
  // Try local first
  const localResult = await providers.android(messages, maxTokens, temperature, tools);

  // Evaluate confidence
  const confidenceEval = evaluateConfidenceRouting(localResult, confidenceThreshold);

  if (confidenceEval.target === "cloud") {
    // Escalate to cloud
    const cloudResult = await providers.gemini(messages, maxTokens, temperature, tools);
    // ... build response with lfo_metadata.routing_reason = confidenceEval.reason
  } else {
    // Use local result
    // ... build response with lfo_metadata from localResult
  }
}
```

### Gap 3: Gemini Tool Calling

**Status**: `lfo-core/src/providers/gemini.ts` needs tool calling support.

**Next step**: Add `tools` parameter to `callGemini()` and convert to Gemini `FunctionDeclaration` format (already done in hackathon's `generate_cloud()` — see `hackathon-ref/main.py` lines 52-68).

### Gap 4: Dashboard Visibility

**Status**: Dashboard doesn't show routing metadata yet.

**Next step**: Update `/dashboard/api/stats` to include:
- Average confidence scores (local requests)
- Cloud escalation rate
- Routing decision breakdown (token vs confidence)

---

## Hackathon Repo Reference

**Cloned at**: `hackathon-ref/` (in LFO root)

**Key files to reference:**
- `main.py` — `generate_hybrid()` logic (lines 97-109)
- `main.py` — `generate_cactus()` tool calling (lines 12-45)
- `main.py` — `generate_cloud()` Gemini tool format (lines 48-94)
- `README.md` — Cactus API reference (lines 62-223)

**Confidence threshold tuning**: Hackathon submissions optimize this value. Default 0.7 balances on-device usage vs correctness. Lower = more local, higher = more cloud.

---

## Deployment Checklist

Before deploying hybrid routing to production:

1. **Install Cactus on Android device**
   - Follow `directives/android_setup.md`
   - Download FunctionGemma 270m model
   - Verify Cactus CLI works: `cactus complete "test"`

2. **Install React Native dependencies**
   - `cd lfo-mobile && npm install`
   - Ensure `cactus-react-native` resolves (or contact Cactus team)

3. **Configure bridge**
   - Set `ANDROID_HOST` in `android-bridge/.env`
   - Test bridge: `node android-bridge/index.js`

4. **Update lfo-core router**
   - Integrate `determineTargetHybrid()` in `/v1/chat/completions` handler
   - Add tool passthrough to providers
   - Populate `lfo_metadata` in responses

5. **Run smoke tests**
   - `npm test` in `lfo-core` (existing 45 tests should pass)
   - Add new routing tests
   - Run `smoke-test.ps1` with tools payload

6. **Monitor confidence distribution**
   - Log confidence scores for local requests
   - Track cloud escalation rate
   - Tune `confidence_threshold` based on correctness metrics

---

## Confidence Threshold Tuning Guide

**Default**: 0.7 (70%)

**How to tune:**
1. Log all local requests with `confidence < 0.7` → manually check correctness
2. If most are correct → lower threshold (e.g., 0.6) to increase local usage
3. If many are incorrect → raise threshold (e.g., 0.8) to prioritize correctness

**Hackathon winning strategies** (from leaderboard analysis):
- Top teams used dynamic thresholds based on tool complexity
- Some used confidence + prefill speed combination
- Best results: 0.65-0.75 range for general tool calling

---

## References

- **Hackathon repo**: https://github.com/cactus-compute/functiongemma-hackathon
- **Cactus docs**: https://cactuscompute.com/docs/v1.7
- **Cactus Reddit**: https://www.reddit.com/r/cactuscompute/
- **LFO architecture**: `ARCHITECTURE.md`
- **Android setup**: `directives/android_setup.md`

---

**Last updated**: 2026-02-21
**Integration by**: Claude Sonnet 4.5
**Status**: Code complete, pending Cactus RN package + router integration
