# LFO Core

The LocalFirst Orchestrator router — an OpenAI-compatible inference gateway that routes
chat requests to either an Android on-device LLM (local) or Google Gemini (cloud).

---

## Architecture

```
OpenClaw / any OpenAI client
        │  POST /v1/chat/completions
        ▼
   lfo-core  (Windows, :8080)
        │
   ┌────┴─────────────────────┐
   │ mode=local / auto+small  │  mode=cloud / auto+large
   ▼                          ▼
android-bridge             Gemini API
(Windows, :5555)           (@google/generative-ai)
        │
        │  TCP :6000
        ▼
  lfo-mobile (Android)
  CactusLM + FunctionGemma
```

**Note:** `android-bridge` is a separate Node process that translates the HTTP call from
`lfo-core` into the newline-delimited TCP JSON protocol used by the React Native app.
`lfo-core` talks to the bridge at `ANDROID_HOST:ANDROID_PORT` — not directly to the phone.

---

## Quick Start

### 1. Install dependencies

```bash
cd lfo-core
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=8080
HOST=0.0.0.0

# Point at android-bridge (runs on same Windows machine)
ANDROID_HOST=127.0.0.1
ANDROID_PORT=5555

# Gemini
GEMINI_API_KEY=your-api-key-here
GEMINI_MODEL=gemini-2.0-flash

# Routing threshold: requests with estimated tokens ≤ this go to Android
MAX_LOCAL_TOKENS=1500
```

### 3. Start the router

```bash
npm run dev        # development (tsx, auto-reload)
npm run build && npm start   # production
```

---

## Prerequisites for Local Path

Before `mode=local` requests work you need:

1. **android-bridge** running on Windows (see `android-bridge/` directory).
2. **lfo-mobile** app running and showing "Ready" on the Android device.

See [directives/android_setup.md](../directives/android_setup.md) for the full setup SOP.

---

## API

### `GET /health`

```json
{ "status": "ok", "timestamp": 1708123456, "version": "0.1.0" }
```

### `POST /v1/chat/completions`

Request (OpenAI-compatible, with optional `metadata.mode`):

```json
{
  "messages": [
    { "role": "user", "content": "What is the capital of France?" }
  ],
  "max_tokens": 256,
  "temperature": 0.7,
  "metadata": { "mode": "auto" }
}
```

`metadata.mode` values:

| Value | Behaviour |
|---|---|
| `"local"` | Force Android device (hard error if offline) |
| `"cloud"` | Force Gemini (hard error on failure) |
| `"auto"` (default) | Token heuristic: small → local, large → cloud |

Response:

```json
{
  "id": "chatcmpl-1708123456-abc123def",
  "object": "chat.completion",
  "created": 1708123456,
  "model": "lfo-local-functiongemma",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Paris." },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 14,
    "completion_tokens": 2,
    "total_tokens": 16
  }
}
```

---

## Manual Smoke Tests

```bash
# Health
curl http://localhost:8080/health

# Cloud path
curl -s -X POST http://localhost:8080/v1/chat/completions ^
  -H "Content-Type: application/json" ^
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"Say hi.\"}],\"metadata\":{\"mode\":\"cloud\"}}"

# Local path (requires android-bridge + lfo-mobile running)
curl -s -X POST http://localhost:8080/v1/chat/completions ^
  -H "Content-Type: application/json" ^
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"What is 2+2?\"}],\"metadata\":{\"mode\":\"local\"}}"
```

---

## Scripts

```bash
npm run dev         # Start with tsx (hot-reload)
npm run build       # Compile TypeScript → dist/
npm start           # Run compiled output
npm run type-check  # TypeScript check (no emit)
npm run lint        # ESLint
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | LFO listen port |
| `HOST` | `0.0.0.0` | LFO listen host |
| `ANDROID_HOST` | `127.0.0.1` | android-bridge host |
| `ANDROID_PORT` | `5555` | android-bridge port |
| `GEMINI_API_KEY` | *(required)* | Google AI API key |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini model ID |
| `MAX_LOCAL_TOKENS` | `1500` | Token threshold for auto-routing |
