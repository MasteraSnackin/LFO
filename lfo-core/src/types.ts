export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

// Tool definition (OpenAI-compatible, for FunctionGemma)
export interface Tool {
  type?: "function";
  function?: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
  };
  // Flat format fallback
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

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: Tool[];  // FunctionGemma tool calling
  metadata?: {
    mode?: "auto" | "local" | "cloud";
    confidence_threshold?: number;  // for hybrid routing
  };
}

export interface ChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage & {
      function_calls?: FunctionCall[];  // FunctionGemma tool calls
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  // Extended metadata for hybrid routing visibility
  lfo_metadata?: {
    confidence?: number;
    routing_reason?: string;
    local_attempt?: boolean;
  };
}

export interface ErrorResponse {
  error: { message: string; type: string; code?: string };
}

// Enhanced provider response with FunctionGemma hybrid routing metadata
export interface ProviderResponse {
  role: "assistant";
  content: string;
  function_calls?: FunctionCall[];  // tool calls from FunctionGemma
  confidence?: number;              // 0-1, model self-assessed confidence
  cloud_handoff?: boolean;          // model recommends cloud escalation
  total_time_ms?: number;           // inference time for routing decisions
}
