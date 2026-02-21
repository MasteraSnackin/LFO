# Routing Directive

## Purpose
Defines how LFO decides which backend handles each `/v1/chat/completions` request.
This document is the authoritative source of truth for routing behaviour.

---

## Routing Decision Tree

```
Incoming request
      │
      ▼
metadata.mode present and valid?
      │
  ┌───┴──────────────────────────┐
  │ "local"                      │ "cloud"
  ▼                              ▼
Force Android bridge         Force Gemini
(fail hard on error,         (fail hard on error,
 no cloud fallback)           no local fallback)
      │                              │
      └──────────┬───────────────────┘
                 │ "auto" (or missing / invalid)
                 ▼
      Estimate prompt tokens
      (chars / 4 heuristic)
                 │
     ┌───────────┴────────────┐
     │ tokens ≤ MAX_LOCAL_TOKENS │ tokens > MAX_LOCAL_TOKENS
     ▼                           ▼
  Android bridge              Gemini
```

---

## metadata.mode Contract

| Value | Behaviour | Error policy |
|---|---|---|
| `"local"` | Always route to Android bridge | Hard error if Android unreachable; no cloud fallback |
| `"cloud"` | Always route to Gemini | Hard error on Gemini failure; no local fallback |
| `"auto"` | Token-count heuristic (see below) | Each backend fails independently |
| missing / invalid | Treated as `"auto"` | Same as `"auto"` |

Any value not in `{ "local", "cloud", "auto" }` is silently treated as `"auto"`.
Do not add silent fallbacks between backends in v0. Hard failures give clearer signals.

---

## Token Threshold

`MAX_LOCAL_TOKENS` defaults to `1500`. Configurable via `MAX_LOCAL_TOKENS` env var.

Token estimation: `Math.ceil(total_chars / 4)`.
This is a character-count heuristic. It is intentionally conservative.
For multi-byte characters or dense code, actual tokens may be higher than estimated.
If you observe consistent misrouting, reduce `MAX_LOCAL_TOKENS`.

---

## Android Backend

- **Endpoint**: `POST http://<ANDROID_HOST>:<ANDROID_PORT>/completion`
- **Target**: `android-bridge` (HTTP), which forwards to the Android TCP server (port 6000).
- **Timeout**: `ANDROID_TIMEOUT_MS` (default 30 000 ms). After timeout → `504` to caller.
- **Request shape**:
  ```json
  { "messages": [...], "max_tokens": 256, "temperature": 0.7 }
  ```
- **Response shape** (success):
  ```json
  { "text": "..." }
  ```
- **Response shape** (error):
  ```json
  { "error": "..." }
  ```
- If the device is offline → `ECONNREFUSED` → `503 service_unavailable`.
- If the device responds with `{ "error": "..." }` → surface that message upstream.

---

## Gemini Backend

- **Model**: `GEMINI_MODEL` env var (default `gemini-2.0-flash`).
- **Timeout**: `CONFIG.gemini.timeout` (default 60 000 ms). Enforced via `Promise.race`.
- **System messages**: extracted and passed as `systemInstruction`. Non-system, non-user turns map to Gemini `model` role.
- **Rate limit** (HTTP 429) → `429 rate_limit_exceeded` to caller.
- **Quota** (HTTP 403) → `403 quota_exceeded` to caller.
- **Timeout** → `504 lfo_timeout` to caller.

---

## Error Mapping

| Condition | HTTP Status | `error.type` |
|---|---|---|
| Android / Gemini timeout | 504 | `lfo_timeout` |
| Gemini rate limit | 429 | `rate_limit_exceeded` |
| Gemini quota/key | 403 | `quota_exceeded` |
| Android unreachable | 503 | `service_unavailable` |
| Any other provider error | 502 | `lfo_provider_error` |
| Bad request (missing messages) | 400 | `invalid_request_error` |

All errors follow the OpenAI error schema:
```json
{ "error": { "message": "...", "type": "...", "code": "local_error|cloud_error" } }
```

---

## Future: Configurable Policies (v1+)
- Per-user or per-tool routing rules (e.g., always cloud for tool calls).
- Automatic cloud fallback when local is degraded (requires circuit breaker).
- Priority queue: prefer local, queue if busy, fallback to cloud after N ms.

*Last Updated: 2026-02-17*
