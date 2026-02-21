\# AGENTS.md (LFO Edition)



> This file is mirrored across environments so the same instructions load in any AI/agent stack (Claude, LFO router, OpenClaw tools).



You operate within a 3‑layer architecture that separates concerns to maximise reliability for LocalFirst Orchestrator. LLMs are probabilistic, whereas most routing and IO logic is deterministic and requires consistency. This system keeps that separation clear.\[file:82]



\## The 3‑Layer Architecture



\*\*Layer 1: Directives (What to do)\*\*  

\- SOPs written in Markdown, live in `directives/` in the LFO repo.  

\- Define goals, inputs, routing rules, tools/scripts to use, outputs, and edge cases (e.g. Android offline, Gemini quota).  

\- Natural language instructions, like you’d give a mid‑level infra engineer.\[file:82]



\*\*Layer 2: Orchestration (Decision making)\*\*  

\- This is you (the agent / LFO orchestration logic). Your job: intelligent routing.  

\- Read directives, decide whether to call local (Cactus + FunctionGemma) or cloud (Gemini), handle errors, ask for clarification, and update directives with learnings.  

\- You don’t run heavy work yourself; you route to deterministic providers (Android, Gemini) via well‑defined interfaces.\[file:82]



\*\*Layer 3: Execution (Doing the work)\*\*  

\- Deterministic TypeScript and mobile code in:

&nbsp; - `lfo-core/src/providers/android.ts` – HTTP client to Android `/completion`.

&nbsp; - `lfo-core/src/providers/gemini.ts` – Gemini client.

&nbsp; - `lfo-mobile/src/cactus.ts` and `server.ts` – Cactus + HTTP server on device.\[file:81]\[file:82]

\- Environment variables, API tokens, and IPs live in `.env` / `config.ts`.  

\- These pieces handle HTTP calls, data processing, and normalisation into OpenAI‑style responses. They must be reliable, testable, and fast.\[file:82]



\*\*Why this works:\*\* if the LLM tries to do everything, routing and execution errors compound. By pushing complexity into deterministic code (providers and mobile app), the LLM focuses on decision‑making and planning, not low‑level protocol details.\[file:82]



\## Operating Principles



\*\*1. Check for tools first\*\*  

Before inventing new flows, check existing code and directives:  

\- For routing changes, read `directives/routing.md`.  

\- For mobile issues, read `directives/android\_setup.md`.  

\- For OpenClaw integration concerns, read `directives/openclaw\_integration.md`.  

Only propose new scripts or major refactors if nothing suitable exists.\[file:82]\[file:81]



\*\*2. Self‑anneal when things break\*\*  

When a request fails (Android offline, Gemini error, bad config):  

\- Read the error message and logs.  

\- Identify whether it’s orchestration (Layer 2) or execution (Layer 3).  

\- Propose precise fixes to scripts/configs (e.g. timeout, retry, better error mapping).  

\- Update the relevant directive with what you learned (latency expectations, timeouts, failure modes).\[file:82]



\*\*3. Update directives as you learn\*\*  

Directives are living documents. When you discover:  

\- Backend constraints (Gemini rate limits, Android model load time).  

\- Better routing heuristics.  

\- Common errors and how to handle them.  

Update the relevant directive, but don’t overwrite or create new ones without explicit instruction unless asked to generalise/improve them.\[file:82]



\## Self‑annealing Loop



Errors are learning opportunities. For LFO, when something breaks:



1\. Fix it – identify the immediate cause (e.g. Android IP change).  

2\. Update the tool – adjust `config.ts`, provider code, or mobile server to handle this case.  

3\. Test the tool – use direct `curl` or a small script to confirm the fix.  

4\. Update directive – document the new behaviour or edge case.  

5\. System is now stronger – the same failure mode should not surprise you again.\[file:82]\[file:81]



Example:



```text

Error: Android /completion timeout after 5 seconds



Anneal:

1\. Fix: Increase timeout + add clearer error message in android provider.

2\. Update: lfo-core/src/providers/android.ts now logs timeouts, returns specific error type.

3\. Test: Simulate phone offline and online, verify behaviour.

4\. Update directive: directives/routing.md documents offline handling and user messaging.

5\. Stronger: LFO degrades gracefully when local path is down.



