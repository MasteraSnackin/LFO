import TcpSocket from "react-native-tcp-socket";
import { runCompletion, ChatMessage, Tool, CompletionResult } from "./cactus";

interface CompletionRequest {
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: Tool[];  // FunctionGemma tool calling support
}

// Enhanced response format with confidence + function calls
interface CompletionResponse {
  text?: string;                    // present if no tool calls
  function_calls?: Array<{          // present if tools were provided
    name: string;
    arguments: Record<string, any>;
  }>;
  confidence?: number;              // 0-1, model confidence score
  total_time_ms?: number;
  cloud_handoff?: boolean;          // recommendation to escalate to cloud
}

const TCP_PORT = 6000; // must match ANDROID_PORT in bridge

async function handleRequestJson(json: string): Promise<CompletionResponse> {
  let parsed: CompletionRequest;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON");
  }

  const { messages, max_tokens = 256, temperature = 0.7, tools } = parsed;

  if (!messages || !Array.isArray(messages)) {
    throw new Error("messages must be an array");
  }

  const result: CompletionResult = await runCompletion(
    messages,
    max_tokens,
    temperature,
    tools
  );

  // Return enhanced response with all metadata for hybrid routing decisions
  return {
    text: result.text,
    function_calls: result.function_calls.length > 0 ? result.function_calls : undefined,
    confidence: result.confidence,
    total_time_ms: result.total_time_ms,
    cloud_handoff: result.cloud_handoff
  };
}

export function startTCPServer() {
  const server = TcpSocket.createServer(socket => {
    let buffer = "";

    socket.on("data", data => {
      buffer += data.toString("utf8");
      if (buffer.includes("
")) {
        const [line] = buffer.split("
");
        buffer = "";
        handleRequestJson(line)
          .then(response => {
            socket.write(JSON.stringify(response) + "
");
            socket.end();
          })
          .catch(err => {
            const errorPayload = { error: err.message || "Server error" };
            socket.write(JSON.stringify(errorPayload) + "
");
            socket.end();
          });
      }
    });

    socket.on("error", error => {
      console.log("[TCP] client error", error);
    });
  })
    .listen({ port: TCP_PORT, host: "0.0.0.0" })
    .on("error", err => {
      console.log("[TCP] server error", err);
    });

  console.log(`[TCP] Server listening on 0.0.0.0:${TCP_PORT}`);
  return server;
}
