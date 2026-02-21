# android-bridge

A thin HTTP→TCP adapter that sits on Windows and connects `lfo-core` to the `lfo-mobile` TCP server running on an Android device.

This is the **transport layer** of the LocalFirst Orchestrator (LFO) local path.

---

## What it does

```
lfo-core (Windows :8080)
        │ HTTP POST /completion
        ▼
android-bridge (Windows :5555)
        │ TCP (newline-delimited JSON)
        ▼
lfo-mobile (Android :6000)
```

1. Receives `POST /completion` from lfo-core
2. Opens a TCP socket to the Android device
3. Sends the request as newline-delimited JSON
4. Reads the response and returns it as JSON to lfo-core
5. Sanitises error messages (strips IP/port) before returning to caller

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | No build step — runs as plain JS |
| Android device on same LAN | Or USB with `adb forward tcp:6000 tcp:6000` |
| lfo-mobile app running | TCP server must be listening on port 6000 |

---

## Setup

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```
BRIDGE_PORT=5555
ANDROID_HOST=<your-android-device-lan-ip>
ANDROID_PORT=6000
ANDROID_TIMEOUT_MS=30000
```

Find your Android device IP:
```bash
adb shell ip addr show wlan0 | grep "inet "
```

Or use USB port forwarding instead of LAN:
```bash
adb forward tcp:6000 tcp:6000
# Then set ANDROID_HOST=127.0.0.1 in .env
```

### 2. Start the bridge

```bash
node index.js
```

Expected output:
```
[bridge] HTTP listening on 0.0.0.0:5555 (/completion)
[bridge] Forwarding to Android TCP 192.168.x.x:6000
```

---

## API

### `POST /completion`

**Request body**
```json
{
  "messages": [{ "role": "user", "content": "hello" }],
  "max_tokens": 256,
  "temperature": 0.7
}
```

**Success response** (HTTP 200)
```json
{ "text": "Hello! How can I help?" }
```

**Error responses**

| Status | Cause |
|---|---|
| 400 | `messages` missing or not an array |
| 502 | TCP connection failed, timeout, or Android returned an error |

```json
{ "error": "Cannot connect to Android device at <device>" }
```

Note: IP addresses are sanitised to `<device>` in all error messages.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `BRIDGE_PORT` | `5555` | Port the HTTP server listens on |
| `ANDROID_HOST` | `192.168.0.50` | LAN IP of the Android device |
| `ANDROID_PORT` | `6000` | TCP port lfo-mobile listens on |
| `ANDROID_TIMEOUT_MS` | `30000` | Timeout per TCP request (ms) |

---

## Implementation notes

`index.js` is a single plain-JavaScript file (JSDoc typed, no build step).

- **One TCP connection per HTTP request** — socket closes after each response
- **Newline delimiter** — request and response are `JSON + "\n"`
- **Timeout** — enforced via `setTimeout` + `socket.destroy()`
- **Error sanitisation** — IP:port stripped from all errors before returning to lfo-core

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ECONNREFUSED` on Android port | lfo-mobile not running | Open the RN app; check Logcat |
| Request hangs | Phone screen locked / app backgrounded | Unlock screen; `adb shell svc power stayon true` |
| `Empty response from Android TCP server` | lfo-mobile closed socket without writing | Check Logcat for Cactus errors |
| lfo-core can't reach bridge | Windows Firewall blocking port 5555 | `New-NetFirewallRule -DisplayName "LFO Bridge" -Direction Inbound -Protocol TCP -LocalPort 5555 -Action Allow` |

**Check bridge is listening:**
```powershell
netstat -ano | findstr :5555
```

**Test bridge directly (bypasses lfo-core):**
```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:5555/completion `
  -ContentType "application/json" `
  -Body '{"messages":[{"role":"user","content":"ping"}],"max_tokens":8,"temperature":0.1}'
```

---

*Part of the [LocalFirst Orchestrator (LFO)](../README.md) project.*
