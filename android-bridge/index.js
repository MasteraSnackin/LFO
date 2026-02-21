// @ts-check
import express from "express";
import bodyParser from "body-parser";
import net from "net";

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 5555);
const ANDROID_HOST = process.env.ANDROID_HOST || "192.168.0.50";
const ANDROID_PORT = Number(process.env.ANDROID_PORT || 6000);
const ANDROID_TIMEOUT_MS = Number(process.env.ANDROID_TIMEOUT_MS || 30000);

const app = express();
app.use(bodyParser.json({ limit: "2mb" }));

/**
 * @typedef {{ role: "system"|"user"|"assistant"|"tool"; content: string }} ChatMessage
 * @typedef {{ name: string; description: string; parameters: object }} Tool
 * @typedef {{ messages: ChatMessage[]; max_tokens?: number; temperature?: number; tools?: Tool[] }} CompletionPayload
 * @typedef {{ text?: string; function_calls?: Array<{name: string; arguments: object}>; confidence?: number; total_time_ms?: number; cloud_handoff?: boolean } | { error: string }} AndroidTCPResponse
 */

/**
 * Open a single TCP connection to the Android device, send a newline-delimited JSON
 * payload, read the response line, and resolve/reject accordingly.
 * One request per connection — the server closes after each reply.
 *
 * @param {CompletionPayload} payload
 * @returns {Promise<{ text: string }>}
 */
function talkToAndroid(payload) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = "";

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Android TCP timeout"));
    }, ANDROID_TIMEOUT_MS);

    socket.connect(ANDROID_PORT, ANDROID_HOST, () => {
      const json = JSON.stringify(payload);
      socket.write(json + "\n");
    });

    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
    });

    socket.on("end", () => {
      clearTimeout(timer);
      try {
        const line = buffer.trim().split("\n").filter(Boolean)[0] || "";
        if (!line) {
          return reject(new Error("Empty response from Android TCP server"));
        }
        /** @type {AndroidTCPResponse} */
        const parsed = JSON.parse(line);
        if ("error" in parsed) {
          return reject(new Error(parsed.error));
        }
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });

    socket.on("error", err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

app.post("/completion", async (req, res) => {
  /** @type {{ messages?: ChatMessage[]; max_tokens?: number; temperature?: number; tools?: Tool[] }} */
  const { messages, max_tokens = 256, temperature = 0.7, tools } = req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages must be an array" });
  }

  try {
    const payload = { messages, max_tokens, temperature };
    if (tools && tools.length > 0) {
      payload.tools = tools;
    }
    const response = await talkToAndroid(payload);

    // Pass through enhanced response with confidence + function_calls
    return res.json({
      text: response.text,
      function_calls: response.function_calls,
      confidence: response.confidence,
      total_time_ms: response.total_time_ms,
      cloud_handoff: response.cloud_handoff
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Android bridge error";
    console.error("[bridge] Error talking to Android:", message);
    // Sanitise: replace IP/port details before returning to caller
    const safe = message.replace(/\d{1,3}(\.\d{1,3}){3}:\d+/g, "<device>");
    return res.status(502).json({ error: safe });
  }
});

app.listen(BRIDGE_PORT, () => {
  console.log(`[bridge] HTTP listening on 0.0.0.0:${BRIDGE_PORT} (/completion)`);
  console.log(`[bridge] Forwarding to Android TCP ${ANDROID_HOST}:${ANDROID_PORT}`);
});
