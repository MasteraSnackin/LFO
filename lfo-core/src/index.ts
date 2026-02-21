import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "./router.js";
import { CONFIG } from "./config.js";
import { getStats } from "./stats.js";

const app = createApp();

const server = app.listen(CONFIG.port, CONFIG.host, () => {
  console.log("╔════════════════════════════════════════════════╗");
  console.log("║  LocalFirst Orchestrator (LFO) v0.1.0         ║");
  console.log("╚════════════════════════════════════════════════╝");
  console.log("");
  console.log(`🚀 Server:        http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`📱 Android:       ${CONFIG.android.host}:${CONFIG.android.port}`);
  console.log(`☁️  Gemini:        ${CONFIG.gemini.model}`);
  console.log(`🧠 Max Local:     ${CONFIG.routing.maxLocalTokens} tokens`);
  console.log("");
  console.log("Endpoints:");
  console.log("  GET  /health");
  console.log("  GET  /v1/models");
  console.log("  POST /v1/chat/completions");
  console.log("  GET  /dashboard");
  console.log("");
  console.log("✅ LFO is ready. Waiting for OpenClaw requests...");
  console.log("");
});

function shutdown(signal: string): void {
  console.log(`\n[LFO] ${signal} received — shutting down gracefully`);

  // Persist session stats to disk before exit
  try {
    const stats = getStats();
    if (stats.recent.length > 0) {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const logPath = path.resolve(__dirname, "..", "..", "lfo-stats.jsonl");
      const line = JSON.stringify({
        shutdown: new Date().toISOString(),
        totals: { requests: stats.total_requests, local: stats.total_local, cloud: stats.total_cloud, errors: stats.total_errors },
        recent: stats.recent
      }) + "\n";
      fs.appendFileSync(logPath, line, "utf8");
      console.log(`[LFO] Stats written to lfo-stats.jsonl (${stats.recent.length} records)`);
    }
  } catch {
    // Non-fatal — stats loss on shutdown is acceptable
  }

  server.close(() => {
    console.log("[LFO] Server closed. Goodbye.");
    process.exit(0);
  });

  // Force-kill after 5s if connections are still open
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
