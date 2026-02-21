# OpenClaw Integration Directive

## Overview

LFO exposes an OpenAI-compatible `/v1/chat/completions` endpoint. Configure OpenClaw to
point its LLM provider at LFO instead of OpenAI or a direct Gemini integration.

LFO runs on `http://localhost:8080` by default. OpenClaw sends standard chat completion
requests; LFO decides whether to route them to the Android device or Gemini.

---

## OpenClaw Provider Configuration

In your OpenClaw config (exact key names depend on your OpenClaw version):

```yaml
llm:
  provider: openai-compatible
  base_url: http://localhost:8080
  model: lfo-auto          # any string — LFO ignores the model field
  api_key: ""              # leave blank; LFO has no auth in v0
```

Or as environment variables if OpenClaw uses them:
```bash
OPENAI_BASE_URL=http://localhost:8080
OPENAI_API_KEY=placeholder
OPENAI_MODEL=lfo-auto
```

---

## Controlling the Routing Mode

Pass `metadata.mode` in the request body to control routing. OpenClaw may support
extra fields in the completion request body via a `metadata` or `extra_body` option.

| Want | Set |
|---|---|
| Always use local device | `metadata.mode = "local"` |
| Always use Gemini | `metadata.mode = "cloud"` |
| Let LFO decide (default) | Omit `metadata` or set `mode = "auto"` |

Example of a raw request for testing:
```bash
# Cloud mode
curl -s -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is the capital of France?"}],
    "metadata": {"mode": "cloud"}
  }'

# Local mode
curl -s -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "metadata": {"mode": "local"}
  }'
```

---

## Response Shape

LFO always returns a valid OpenAI chat completion object:

```json
{
  "id": "chatcmpl-1234567890-abc123",
  "object": "chat.completion",
  "created": 1708123456,
  "model": "lfo-local-functiongemma",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "The answer is 4." },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 8,
    "total_tokens": 20
  }
}
```

The `model` field will be `"lfo-local-functiongemma"` or `"lfo-gemini"` depending on which backend handled the request.

Token counts in `usage` are approximate (character-count heuristic ÷ 4).

---

## Error Handling

LFO returns structured errors in OpenAI error format:

```json
{
  "error": {
    "message": "Cannot reach Android device at http://127.0.0.1:5555/completion. Verify IP and port in .env",
    "type": "service_unavailable",
    "code": "local_error"
  }
}
```

Configure OpenClaw to treat 503/502/504 responses as retryable or escalate to a fallback skill.

---

## Health Check

Before starting an OpenClaw session, verify LFO is running:

```bash
curl http://localhost:8080/health
# {"status":"ok","timestamp":1708123456,"version":"0.1.0"}
```

---

## Checklist Before Running OpenClaw with LFO

- [ ] `lfo-core` started (`npm run dev` in `lfo-core/`)
- [ ] `android-bridge` started (`node index.js` in `android-bridge/`) — if using local mode
- [ ] `lfo-mobile` app showing "Ready" on Android — if using local mode
- [ ] `curl GET /health` returns `{"status":"ok",...}`
- [ ] `curl POST /v1/chat/completions` with `mode=cloud` returns a valid response
- [ ] `curl POST /v1/chat/completions` with `mode=local` returns a valid response
- [ ] OpenClaw `base_url` pointed at `http://localhost:8080`

---

## Known Limitations (v0)

- **No streaming**: LFO returns completions in one shot. If OpenClaw uses SSE/streaming mode, disable it or configure non-streaming in the OpenClaw provider settings.
- **No tool-call routing**: LFO does not inspect tool calls or function call payloads when making routing decisions. All routing is based on `metadata.mode` and prompt token count.
- **No authentication**: Any client on the same machine or LAN can call LFO. Do not expose port 8080 to the public internet without adding auth.

*Last Updated: 2026-02-17*
