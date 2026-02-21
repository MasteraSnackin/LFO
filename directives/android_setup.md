# Android Setup SOP

## Overview

The local inference path is a 3-hop chain:

```
LFO (Windows, port 8080)
    └─► android-bridge (Windows, port 5555)   [HTTP]
            └─► lfo-mobile (Android, port 6000)  [TCP newline-delimited JSON]
                    └─► CactusLM / FunctionGemma  [on-device]
```

The bridge runs on **Windows alongside LFO** and translates HTTP calls to the raw TCP
protocol used by the React Native app. The Android device only needs TCP port 6000 open.

---

## Prerequisites

| Item | Detail |
|---|---|
| Android device | USB debug enabled; on same LAN as Windows machine |
| Node.js | ≥ 18 (for android-bridge) |
| React Native CLI | `npm install -g react-native-cli` |
| ADB | In PATH (from Android SDK platform-tools) |
| Model file | `function-gemma-270m.gguf` on device at `/sdcard/function-gemma-270m.gguf` |

---

## Step 1: Push the model file to the device

```bash
# From Windows PowerShell / CMD
adb push path\to\function-gemma-270m.gguf /sdcard/function-gemma-270m.gguf

# Verify
adb shell ls -lh /sdcard/function-gemma-270m.gguf
```

Expected output: file size ~270 MB.

---

## Step 2: Build and install lfo-mobile

```bash
cd lfo-mobile
npm install
npm run android
```

The app will:
1. Load and initialise CactusLM with `function-gemma-270m.gguf` (takes ~5–20 s on first run).
2. Start a TCP server on `0.0.0.0:6000`.
3. Display "✅ Ready on port 6000" in the status card.

Do **not** proceed until the app shows "Ready".

---

## Step 3: Find the Android device IP

```bash
adb shell ip route
# or
adb shell ifconfig wlan0
```

Note the `192.168.x.x` LAN IP. You'll need this for the bridge config.

---

## Step 4: Configure and start android-bridge

```bash
cd android-bridge
npm install

# Set environment variables (PowerShell)
$env:ANDROID_HOST = "192.168.x.x"   # Android device LAN IP from Step 3
$env:ANDROID_PORT = "6000"
$env:BRIDGE_PORT  = "5555"

node index.js
```

Expected log:
```
[bridge] HTTP listening on 0.0.0.0:5555 (/completion)
[bridge] Forwarding to Android TCP 192.168.x.x:6000
```

---

## Step 5: Verify connectivity

```bash
# From Windows — test the bridge → Android path
curl -s -X POST http://127.0.0.1:5555/completion ^
  -H "Content-Type: application/json" ^
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in one sentence.\"}],\"max_tokens\":64}"
```

Expected: `{ "text": "Hello! ..." }`

If you get a connection error, check:
- Android app is showing "Ready" (not an error state).
- `ANDROID_HOST` is correct (use `adb shell ip route` to re-check).
- TCP port 6000 is not blocked by Android firewall.
- Both devices are on the same WiFi network (not separated by AP isolation).

---

## Step 6: Configure LFO core to use the bridge

In `lfo-core/.env`:
```
ANDROID_HOST=127.0.0.1
ANDROID_PORT=5555
```

(`127.0.0.1` because the bridge runs on the same Windows machine as LFO core.)

---

## Step 7: End-to-end smoke test

```bash
curl -s -X POST http://127.0.0.1:8080/v1/chat/completions ^
  -H "Content-Type: application/json" ^
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"What is 2+2?\"}],\"metadata\":{\"mode\":\"local\"}}"
```

Expected: OpenAI-compatible response with `choices[0].message.content` containing the answer and `usage.total_tokens` populated.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| App stuck on "Initializing…" | Model file missing or path wrong | Re-run `adb push`, check `MODEL_PATH` in `cactus.ts` |
| `ECONNREFUSED` on bridge call | Bridge not running or wrong port | Start `android-bridge/index.js` |
| `Android TCP timeout` | Device unreachable on TCP 6000 | Check WiFi, AP isolation, Android firewall |
| Empty `text` in response | Cactus returned no tokens | Reduce `max_tokens`, check model load logs in app |
| Garbled / truncated output | TCP buffer split mid-message | Confirm single request per connection (expected for v0) |

---

## Known Constraints (v0)

- **One request at a time**: The TCP server in `lfo-mobile/src/server.ts` opens a connection per request. Concurrent requests will queue at the bridge. This is acceptable for single-agent use.
- **No streaming**: Completions are returned in one shot.
- **Model path is hardcoded** as `/sdcard/function-gemma-270m.gguf` in `cactus.ts`. Change `MODEL_PATH` there to use a different path.

*Last Updated: 2026-02-17*
