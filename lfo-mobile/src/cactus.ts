import { CactusLM } from "cactus-react-native";

// Model configuration — update this path if you move the model file on the device.
const MODEL_PATH = "/sdcard/function-gemma-270m.gguf";
const MODEL_CONTEXT = 2048;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

// Tool definition format (OpenAI-compatible, mirrors hackathon repo)
export interface Tool {
  type?: "function";  // optional for compat
  function?: {        // nested if type=function
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
  };
  // flat format fallback (direct name/description/parameters)
  name?: string;
  description?: string;
  parameters?: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface FunctionCall {
  name: string;
  arguments: Record<string, any>;
}

export interface CompletionResult {
  text?: string;                // plain text response (no tool calls)
  function_calls: FunctionCall[];
  confidence: number;           // 0-1, model's self-assessed confidence
  total_time_ms: number;
  cloud_handoff?: boolean;      // true if model recommends cloud fallback
}

// CactusLM doesn't export its instance type publicly; infer it from the init return.
type CactusInstance = Awaited<ReturnType<typeof CactusLM.init>>["lm"];

let lmInstance: CactusInstance | null = null;
// Cache init failure so repeated callers don't each trigger a slow re-attempt.
let initError: Error | null = null;

export async function initCactus(): Promise<CactusInstance> {
  if (lmInstance) return lmInstance;
  if (initError) throw initError;

  console.log("[Cactus] Initializing FunctionGemma model...");
  const { lm, error } = await CactusLM.init({
    model: MODEL_PATH,
    n_ctx: MODEL_CONTEXT
  });

  if (error) {
    initError = new Error(`CactusLM init failed: ${error}`);
    throw initError;
  }

  console.log("[Cactus] Model loaded successfully");
  lmInstance = lm;
  return lmInstance;
}

// Normalize tool format: flatten if nested (type=function), or pass through
function normalizeTools(tools?: Tool[]): any[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => {
    if (t.type === "function" && t.function) {
      // Nested format → flatten
      return { type: "function", function: t.function };
    }
    // Assume flat format or already normalized
    return t;
  });
}

export async function runCompletion(
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
  tools?: Tool[]
): Promise<CompletionResult> {
  const lm = await initCactus();
  const startTime = Date.now();

  console.log(
    `[Cactus] Running completion: ${messages.length} messages, max_tokens=${maxTokens}, tools=${tools?.length ?? 0}`
  );

  const cactusTools = normalizeTools(tools);
  const opts: any = {
    n_predict: maxTokens,
    temperature
  };

  // If tools provided, enable function calling mode
  if (cactusTools && cactusTools.length > 0) {
    opts.tools = cactusTools;
    opts.force_tools = true;  // FunctionGemma-specific: constrain output to tool calls
  }

  const response = await lm.completion(messages, opts);
  const totalTime = Date.now() - startTime;

  // Parse the Cactus response (mirroring hackathon's cactus_complete JSON shape)
  // Note: cactus-react-native may not fully match Python API — adapt as needed
  const functionCalls: FunctionCall[] = response?.function_calls ?? [];
  const confidence: number = response?.confidence ?? 0.5;  // default mid-range if not provided
  const cloudHandoff: boolean = response?.cloud_handoff ?? false;

  // If no tool calls, extract text response
  const text =
    response?.response ??
    response?.choices?.[0]?.text ??
    response?.choices?.[0]?.message?.content ??
    "";

  console.log(
    `[Cactus] Completion finished: ${functionCalls.length} tool calls, confidence=${confidence.toFixed(2)}, time=${totalTime}ms`
  );

  return {
    text: text || undefined,
    function_calls: functionCalls,
    confidence,
    total_time_ms: totalTime,
    cloud_handoff: cloudHandoff
  };
}
