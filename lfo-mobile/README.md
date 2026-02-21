# lfo-mobile

React Native app that runs **CactusLM + FunctionGemma 270M** on an Android device and exposes a TCP server for the `android-bridge` to connect to.

This is the **local inference layer** of the LocalFirst Orchestrator (LFO) stack.

---

## What it does

1. On startup, loads `function-gemma-270m.gguf` from `/sdcard/` into memory via Cactus.
2. Starts a TCP server on port `6000`.
3. Accepts newline-delimited JSON requests from `android-bridge`.
4. Runs the completion through CactusLM and writes the JSON response back over the same socket.

```
android-bridge (Windows :5555)
        │ TCP
        ▼
lfo-mobile TCP server (:6000)
        │
        ▼
CactusLM → FunctionGemma 270M
```

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20+ | For Metro bundler |
| React Native CLI | Latest | `npm install -g react-native-cli` |
| Android SDK | API 31+ | Via Android Studio |
| Android device | Physical preferred | USB debugging enabled |
| Model file | `function-gemma-270m.gguf` | GGUF format, quantised |

---

## Setup

### 1. Install dependencies

```bash
cd lfo-mobile
npm install
```

### 2. Push the model file to the device

```bash
adb push function-gemma-270m.gguf /sdcard/function-gemma-270m.gguf

# Verify
adb shell ls -lh /sdcard/function-gemma-270m.gguf
```

The model path is hardcoded in `src/cactus.ts`:
```typescript
const MODEL_PATH = "/sdcard/function-gemma-270m.gguf";
```

### 3. Run the app

```bash
# Connect Android device via USB with USB debugging enabled
npm run android

# Or start Metro separately then build
npx react-native start
npx react-native run-android
```

### 4. Verify the TCP server is running

Forward the port over USB then test from Windows:
```bash
adb forward tcp:6000 tcp:6000
```

```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:6000/completion `
  -ContentType "application/json" `
  -Body '{"messages":[{"role":"user","content":"Say PONG only."}],"max_tokens":8,"temperature":0.1}'
```

Expected: `{ "text": "PONG" }` (or a short coherent response)

---

## Source files

| File | Purpose |
|---|---|
| `App.tsx` | RN app shell — initialises Cactus on mount, shows status screen |
| `src/cactus.ts` | CactusLM wrapper — `initCactus()`, `runCompletion()` |
| `src/server.ts` | TCP server — listens on port 6000, parses requests, calls `runCompletion()` |

### `src/cactus.ts` — key behaviour

- `MODEL_PATH = "/sdcard/function-gemma-270m.gguf"` — change here if you move the file
- `MODEL_CONTEXT = 2048` — token context window
- Init failure is **cached** in `initError` — if Cactus fails to load, every subsequent call returns the cached error immediately. To retry: force-close and reopen the app.
- `lmInstance` is kept as a module-level singleton — model loads once per app session

### `src/server.ts` — key behaviour

- **One request per TCP connection** — buffer cleared and socket closed after each response
- **Newline (`\n`) is the message delimiter**
- On error, responds with `{ "error": "<message>" }` — surfaced by `android-bridge`
- Port: `6000` (constant `TCP_PORT`)

---

## Request / response format

**Request (newline-terminated JSON sent over TCP)**
```json
{"messages":[{"role":"user","content":"hello"}],"max_tokens":256,"temperature":0.7}
```

**Success response**
```json
{"text":"Hello! How can I help you today?"}
```

**Error response**
```json
{"error":"Cactus returned empty completion"}
```

---

## Configuration

All configuration is via constants in source — no `.env` file for the mobile app.

| Constant | File | Default | Notes |
|---|---|---|---|
| `MODEL_PATH` | `src/cactus.ts` | `/sdcard/function-gemma-270m.gguf` | Push model here with `adb push` |
| `MODEL_CONTEXT` | `src/cactus.ts` | `2048` | Max token context window |
| `TCP_PORT` | `src/server.ts` | `6000` | Must match `ANDROID_PORT` in android-bridge `.env` |

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `react-native` | 0.73.6 | RN framework |
| `cactus-react-native` | ^0.2.6 | On-device LLM inference (llama.cpp bindings) |
| `react-native-tcp-socket` | ^5.3.0 | TCP server on Android |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| App shows "Model not ready" | Model file missing from `/sdcard/` | `adb push function-gemma-270m.gguf /sdcard/` |
| Cold load takes 30–90s | Normal for first load of 270M model | Wait — do not close the app |
| Cached error returns instantly | `initError` cached from previous failure | Force-close + reopen the app |
| TCP server not responding | App backgrounded / screen locked | Unlock screen; `adb shell svc power stayon true` |
| `ECONNREFUSED` from android-bridge | TCP server not started | Check Logcat: `adb logcat -s ReactNativeJS` |

**Watch logs in real time:**
```bash
adb logcat -s ReactNativeJS CactusLM
```

---

*Part of the [LocalFirst Orchestrator (LFO)](../README.md) project.*
