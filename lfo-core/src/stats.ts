/**
 * In-process request statistics for the LFO dashboard.
 * No imports from providers or router — data flows in via recordRequest().
 */

export interface RequestRecord {
  ts: string;                  // ISO timestamp
  mode: string;                // "auto" | "local" | "cloud"
  target: string;              // "local" | "cloud"
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  status: number;              // HTTP status returned to caller
  error: string | null;        // null on success
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------
const RING_SIZE = 50;
const ringBuffer: RequestRecord[] = [];

// ---------------------------------------------------------------------------
// Counters (reset only on process restart)
// ---------------------------------------------------------------------------
const START_TIME = Date.now();
let totalRequests = 0;
let totalLocal = 0;
let totalCloud = 0;
let totalErrors = 0;
let sumLatencyLocal = 0;
let sumLatencyCloud = 0;
let circuitTripCount = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function recordRequest(r: RequestRecord): void {
  ringBuffer.push(r);
  if (ringBuffer.length > RING_SIZE) ringBuffer.shift();

  totalRequests += 1;
  if (r.target === "local") {
    totalLocal += 1;
    sumLatencyLocal += r.latency_ms;
  } else {
    totalCloud += 1;
    sumLatencyCloud += r.latency_ms;
  }
  if (r.status >= 400) totalErrors += 1;
}

export function incrementCircuitTrips(): void {
  circuitTripCount += 1;
}

export function getStats() {
  return {
    uptime_ms: Date.now() - START_TIME,
    total_requests: totalRequests,
    total_local: totalLocal,
    total_cloud: totalCloud,
    total_errors: totalErrors,
    avg_latency_local_ms: totalLocal > 0 ? Math.round(sumLatencyLocal / totalLocal) : 0,
    avg_latency_cloud_ms: totalCloud > 0 ? Math.round(sumLatencyCloud / totalCloud) : 0,
    circuit_trip_count: circuitTripCount,
    recent: [...ringBuffer].reverse()  // newest first
  };
}
