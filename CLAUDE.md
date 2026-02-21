text
# LFO.md

## Project Context

LocalFirst Orchestrator (LFO): A hybrid inference router that lets OpenClaw agents decide, per request, whether to run locally on‑device (Cactus + FunctionGemma on Android) or in the cloud (Gemini APIs), with an OpenAI‑compatible interface for easy integration.[web:21][web:24][web:9][web:4][web:15]

## Problem Statement

**User Pain**: Agentic systems typically bind to a single LLM endpoint (cloud or local). That makes it hard to:  
- Exploit on‑device speed and privacy when tasks are small/simple.  
- Escalate automatically to more capable cloud models for complex, long‑context reasoning.  
- Keep one clean integration surface for tools like OpenClaw while mixing multiple backends.[web:32][web:37]

**Current Alternatives**:  
- Direct OpenAI/Gemini integration: always cloud, higher latency and cost, weaker privacy.  
- Pure local LLMs (Ollama, llama.cpp, Cactus‑only): great for speed/privacy but limited context/window and capability.  
- Ad‑hoc routing in agents: per‑project glue code, no reusable router, no consistent API surface.[web:32][web:39]

**Our Solution**: A small, reusable router service that exposes an OpenAI‑compatible `/v1/chat/completions` endpoint to OpenClaw and routes each request to either:  
- Cactus + FunctionGemma running on Android over LAN (local path).  
- Gemini 2.x models via Gemini APIs (cloud path).  
Routing is based on simple, inspectable rules (context size, mode flag) with explicit override and clean error handling.

**Target Users**:  
- Developers building OpenClaw‑style agents who want hybrid edge+cloud inference.  
- Makers running local models on phones but still needing cloud “oracle” power.  
- Teams experimenting with offline‑first assistants that escalate to cloud selectively.[web:34][web:43]

## Success Criteria (Initial Build – LFO v0)

Priority 1 (Must Have):  
- [ ] LFO core exposes `POST /v1/chat/completions` with OpenAI‑compatible JSON (no streaming).  
- [ ] Local path: route to Android device (React Native + Cactus + FunctionGemma) and return answer.  
- [ ] Cloud path: route to Gemini (`gemini-2.0-flash` or similar) and return answer.  
- [ ] Simple routing rule: `metadata.mode` (`local|cloud|auto`) + token‑based heuristic when `auto`.  
- [ ] Basic README with architecture diagram and run instructions for Windows + Android.

Priority 2 (Should Have):  
- [ ] Health endpoints: `/health` in LFO and mobile app.  
- [ ] Structured error mapping (Android failures → partial response + error; Gemini failures → clear error).  
- [ ] Minimal logging/metrics in LFO (which backend, latency, token estimate).  
- [ ] OpenClaw config example using LFO as LLM provider.

Priority 3 (Nice to Have):  
- [ ] Simple Web UI dashboard for LFO (recent requests, which backend handled them).  
- [ ] Configurable routing policies (per‑tool or per‑tenant rules).  
- [ ] Token accounting to estimate local vs cloud cost.

## Tech Stack

- **Router**: Node.js + TypeScript (strict)  
- **Agent layer**: OpenClaw (self‑hosted) using OpenAI‑compatible provider config[web:24][web:21]  
- **Local inference**: Cactus + FunctionGemma on Android, wrapped in React Native and exposed via HTTP[web:9][web:22][web:8][web:4]  
- **Cloud inference**: Gemini 2.x via `@google/generative-ai` Node client[web:61][web:63][web:15]  
- **Transport**: HTTP/JSON (no streaming in v0)  
- **Deployment**:  
  - LFO: Windows (bare Node)  
  - Mobile: Android phone on same LAN

## Key Directories

```text
localfirst-orchestrator/
├── lfo-core/
│   ├── src/
│   │   ├── config.ts           — Ports, Android IP, Gemini model/key, routing thresholds
│   │   ├── router.ts           — POST /v1/chat/completions (OpenAI-compatible)
│   │   ├── providers/
│   │   │   ├── android.ts      — Call Android RN+Cactus /completion endpoint
│   │   │   └── gemini.ts       — Call Gemini chat APIs, map to OpenAI-style message
│   │   └── health.ts           — Simple /health route (optional)
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
├── lfo-mobile/
│   ├── App.tsx                 — RN app; init Cactus, start HTTP server, show status
│   ├── src/
│   │   ├── cactus.ts           — CactusLM init + runCompletion wrapper
│   │   └── server.ts           — HTTP server exposing POST /completion
│   ├── android/…               — Native Android project files
│   ├── package.json
│   └── README.md
├── directives/
│   ├── routing.md              — Rules for local vs cloud, metadata.mode semantics
│   ├── android_setup.md        — Android+Cactus+FunctionGemma setup SOP
│   └── openclaw_integration.md — How to point OpenClaw at LFO
└── LFO.md                      — This file
Commands
In lfo-core/:

npm run dev — Start LFO router on localhost (Node + ts-node).

npm run build — Compile TypeScript to JS.

npm start — Run compiled router.

In lfo-mobile/:

npm run android — Start the RN app on connected Android device/emulator.

npm run lint — Lint JS/TS (if configured).

Top‑level (optional):

make dev — Start both LFO core and RN app (if you add a Makefile).

make test-local — Hit /v1/chat/completions with mode=local and assert success.

make test-cloud — Hit /v1/chat/completions with mode=cloud and assert success.

Architecture: 3‑Layer System
Layer 1: Directives (What to do)
directives/routing.md: Defines routing policies, metadata.mode contract, token thresholds, and failure behaviour (fallback vs hard error).

directives/android_setup.md: SOP to get Cactus + FunctionGemma running on Android + RN, including model paths, network config, and testing via curl.

directives/openclaw_integration.md: Steps and config snippets to wire OpenClaw to LFO’s OpenAI‑compatible endpoint.

Layer 2: Orchestration (Decision making – LFO core)
src/router.ts: Receives OpenAI‑style requests from OpenClaw and decides:

Estimate tokens from messages.

Respect metadata.mode (“local”, “cloud”, “auto”).

If auto: small context → Android; large context → Gemini.

Normalises responses into OpenAI‑compatible JSON with choices[0].message.

Handles errors and returns structured error responses (HTTP 4xx/5xx with JSON body).

Layer 3: Execution (Deterministic work)
providers/android.ts: Deterministic HTTP client to Android /completion.

providers/gemini.ts: Deterministic Gemini client and mapping logic.

lfo-mobile/src/cactus.ts: Deterministic CactusLM wrapper.

lfo-mobile/src/server.ts: Deterministic HTTP request handling on device.

Why this works: OpenClaw remains probabilistic and agentic, but the decision about where to run each step and the mechanics of calling each backend are deterministic, testable functions.

How I Want You to Work (for LFO)
Before Coding
Check directives first: Read directives/routing.md or directives/android_setup.md before changing routing logic or mobile setup.

Ask clarifying questions if any piece of the flow (OpenClaw → LFO → Android/Gemini) is ambiguous.

Draft a plan for non‑trivial changes (e.g. adding streaming, new routing rules) and validate it.

If unsure, ask — do not guess about Cactus API signatures, mobile network behaviour, or OpenClaw configs.

While Coding
Write complete, working code — no placeholders, no “TODO later” in core paths.

Prefer clarity over clever abstractions, given this is infra glue.

Follow existing patterns in providers/* and src/router.ts.

One change at a time, with clear scope.

TypeScript strictly in lfo-core: no any escapes in core files.

Error handling is mandatory: each network call (Android, Gemini) must have try/catch and return useful errors to caller.

After Coding
Run type check / build in lfo-core.

Test both paths manually:

mode=local → confirm Android handles the call.

mode=cloud → confirm Gemini handles the call.

Verify OpenClaw still works with LFO as its LLM provider for a simple test skill.

Summarise changes: what was changed, why, any behavioural implications.

Code Style (LFO core)
ES modules: Use import/export everywhere.

Types everywhere in core (request/response shapes, providers).

Descriptive names: routeRequestToBackend over handle, androidProvider over ap.

No commented‑out code: remove dead code or re‑add via git if needed.

Async/await for async flows.

Early returns to reduce nesting.

Do Not
❌ Hardcode IPs, ports, or API keys in source – always via config/env.

❌ Change OpenClaw code unless explicitly in scope; treat it as a client.

❌ Assume Android is reachable – always handle timeouts/failures.

❌ Assume Gemini responses: parse and normalise robustly.

❌ Skip network/error handling for “happy path only” demos.

Verification Loop
A change is not done until:

✅ LFO core builds without TS errors.

✅ Manual curl to /v1/chat/completions works for:

metadata.mode = "local"

metadata.mode = "cloud"

✅ Android /completion responds when the app is running.

✅ OpenClaw can run at least one simple conversation via LFO.

If any of these fail, fix before marking the task complete.

Quick Commands (Shared Vocabulary)
When I use these words about LFO:

"plan" — Analyse the change, propose a concrete approach and file list, ask for missing constraints.

"build" — Implement the agreed plan in code, keeping scope tight.

"check" — Review implementation for robustness: network failures, type safety, routing correctness, logging.

"verify" — Run the verification loop: build, manual tests, OpenClaw integration sanity checks.

"done" — Summarise what changed, what was tested, known limitations, and next steps.

"anneal" — When something breaks (e.g. Android offline, Gemini error), improve the system:

Identify root cause.

Fix the specific bug.

Improve the relevant directive or config.

Add a test/manual check so it doesn’t regress.

Project‑Specific Constraints
Routing Behaviour
metadata.mode = "local" → force Android (if it fails, return error; no silent cloud fallback in v0).

metadata.mode = "cloud" → force Gemini.

metadata.mode = "auto" (or missing):

Estimate tokens from messages.

If tokens ≤ maxLocalTokens → Android.

Else → Gemini.

Future: configurable policies per user/skill.

Android + Cactus
Cactus + FunctionGemma must be initialised before the HTTP server reports “ready”.

Model file path and Cactus configuration live in android_setup.md and cactus.ts, not sprinkled around.

LAN connectivity must be tested from Windows to Android before debugging LFO.

OpenClaw Integration
LFO must not depend on OpenClaw internals; it only speaks OpenAI‑compatible HTTP.

Any OpenClaw‑specific hints go in directives/openclaw_integration.md (e.g. where to set model name, base URL).

Timeline (v0, 1–2 focused days)
Phase 1: Foundation

Scaffold lfo-core and lfo-mobile.

Get Cactus + FunctionGemma running on Android with a local /completion test.

Phase 2: Router + Gemini

Implement Android provider + Gemini provider + routing.

Verify both paths via curl from Windows.

Phase 3: OpenClaw Integration

Configure OpenClaw to use LFO as LLM provider.

Run a minimal agent/skill and confirm both local/cloud modes work by flipping metadata.mode.

Phase 4: Hardening

Add health checks, better logging, and document setup in README + directives/*.md.

Last Updated: 2026‑02‑17
Project: LocalFirst Orchestrator (LFO)