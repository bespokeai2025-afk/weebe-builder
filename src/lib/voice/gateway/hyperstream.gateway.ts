/**
 * HyperStream gateway — browser <-> OpenAI Realtime relay.
 *
 * Extracted from hyperstream-relay.plugin.ts so the same relay runs in the Vite
 * dev server and in production (srvx). Previously this lived only in a Vite
 * plugin, so deployed agents had no relay at all.
 *
 * Two modes:
 *
 * 1. Proxy mode (no ?agentId) — the builder test-call UI. Frames are forwarded
 *    unchanged and the browser executes tool calls itself.
 *
 * 2. Deployed mode (?agentId=<uuid>) — phone/production agents with no browser
 *    executor. The relay loads the agent's tool registry and executes tool calls
 *    server-side, injecting function_call_output back into OpenAI.
 *
 * relay.* messages from the browser are for the relay itself and are never
 * forwarded to OpenAI, which would reject them.
 */
import { WebSocket } from "ws";
import type { VoiceGatewayContext, VoiceGatewayRoute } from "./types";
import { REALTIME_MODEL, openRealtimeSocket } from "./realtime-session";

const RELAY_PATH = "/api/hyperstream-relay";

interface ToolEntry {
  tool_type?: string;
  url?: string;
  api_url?: string;
}

/** Normalise a tool row from either the internal endpoint or the browser. */
function toToolEntry(t: Record<string, unknown>): ToolEntry {
  return {
    tool_type: typeof t.tool_type === "string" ? t.tool_type : undefined,
    url: typeof t.url === "string" ? t.url : undefined,
    api_url: typeof t.api_url === "string" ? t.api_url : undefined,
  };
}

/**
 * Fetch the agent's tool registry from the internal endpoint so the relay can
 * execute any tool without user auth.
 */
async function fetchToolRegistry(agentId: string, base: string): Promise<Map<string, ToolEntry>> {
  const registry = new Map<string, ToolEntry>();
  try {
    const res = await fetch(`${base}/api/internal/agent-tools/${agentId}`, {
      headers: { "x-internal-relay": "true" },
    });
    if (!res.ok) {
      console.warn(
        `[hyperstream-gateway] tool registry fetch failed: HTTP ${res.status} for agentId=${agentId}`,
      );
      return registry;
    }
    const json = (await res.json()) as {
      ok?: boolean;
      tools?: Array<Record<string, unknown>>;
    };
    for (const t of json.tools ?? []) {
      const name = typeof t.name === "string" ? t.name : "";
      if (name) registry.set(name, toToolEntry(t));
    }
    console.log(
      `[hyperstream-gateway] tool registry loaded: ${registry.size} tools for agentId=${agentId}`,
    );
  } catch (e) {
    console.warn(
      `[hyperstream-gateway] tool registry fetch error for agentId=${agentId}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
  return registry;
}

/**
 * Execute a tool call. Always resolves — failures come back as a JSON error
 * string so the conversation continues instead of hanging.
 */
async function executeTool(
  toolName: string,
  rawArgs: string,
  entry: ToolEntry,
  agentId: string | null,
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    /* keep empty */
  }

  // Lets the target endpoint resolve the workspace.
  if (agentId) args.agent_id = agentId;

  if (entry.tool_type === "end_call") {
    return JSON.stringify({ ended: true, message: "Call ended by agent." });
  }

  if (entry.tool_type === "transfer_call") {
    const dest = args.destination ?? args.transfer_destination ?? "operator";
    return JSON.stringify({ transferred: true, destination: dest });
  }

  const webhookUrl = entry.url || entry.api_url;
  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: toolName, args }),
      });
      return res.text();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[hyperstream-gateway] webhook error for tool "${toolName}":`, msg);
      return JSON.stringify({ error: `Tool "${toolName}" webhook failed: ${msg}` });
    }
  }

  // Acknowledge unknown tools so the session doesn't stall waiting for output.
  return JSON.stringify({
    result: "acknowledged",
    tool: toolName,
    note: "Tool registered but no executor available.",
  });
}

function handleConnection(browserWs: WebSocket, ctx: VoiceGatewayContext): void {
  const { url } = ctx;
  const modelParam = url.searchParams.get("model") ?? REALTIME_MODEL;
  // Builder test calls pass agentRowId instead, so they stay in proxy mode.
  const agentId = url.searchParams.get("agentId") ?? null;
  const apiKey = process.env.OPENAI_API_KEY!;

  const toolRegistry = new Map<string, ToolEntry>();

  // Loaded in the background: session.update plus the first response always
  // takes longer than this fetch in practice.
  if (agentId) {
    void fetchToolRegistry(agentId, ctx.internalBaseUrl()).then((reg) => {
      for (const [name, entry] of reg) toolRegistry.set(name, entry);
    });
  }

  console.log(
    `[hyperstream-gateway] browser WS upgraded (${agentId ? `deployed agentId=${agentId}` : "proxy"}), connecting to OpenAI model=${modelParam}`,
  );
  const openaiWs = openRealtimeSocket(apiKey, modelParam);

  openaiWs.on("open", () => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: "relay.connected" }));
    }
  });

  /** Feed a tool result back into the conversation and ask for a response. */
  function sendToolOutput(callId: string, output: string): void {
    if (openaiWs.readyState !== WebSocket.OPEN) return;
    openaiWs.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output },
      }),
    );
    openaiWs.send(JSON.stringify({ type: "response.create" }));
  }

  openaiWs.on("message", (data: import("ws").RawData, isBinary: boolean) => {
    if (!isBinary) {
      const str = data.toString();
      // Audio deltas are far too frequent and large to parse or log.
      const isAudioDelta =
        str.indexOf('"response.output_audio.delta"') !== -1 ||
        str.indexOf('"response.audio.delta"') !== -1;

      if (!isAudioDelta) {
        try {
          const msg = JSON.parse(str) as Record<string, unknown>;

          if (agentId && msg.type === "response.function_call_arguments.done") {
            const toolName = msg.name as string;
            const callId = msg.call_id as string;
            const rawArgs = (msg.arguments as string) ?? "{}";
            const entry = toolRegistry.get(toolName);

            if (entry) {
              console.log(
                `[hyperstream-gateway] executing tool server-side: "${toolName}" callId=${callId}`,
              );
              void (async () => {
                try {
                  const result = await executeTool(toolName, rawArgs, entry, agentId);
                  sendToolOutput(callId, result);

                  // Browser copy is for UI display only, never re-execution.
                  if (browserWs.readyState === WebSocket.OPEN) {
                    browserWs.send(
                      JSON.stringify({
                        type: "relay.tool_executed",
                        tool: toolName,
                        call_id: callId,
                        result,
                      }),
                    );
                  }

                  // Give the model time to say goodbye before hanging up.
                  if (entry.tool_type === "end_call") {
                    setTimeout(() => {
                      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
                    }, 4000);
                  }
                } catch (toolErr) {
                  const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
                  console.error(`[hyperstream-gateway] tool "${toolName}" failed:`, errMsg);
                  sendToolOutput(callId, JSON.stringify({ error: errMsg }));
                }
              })();

              // Handled here — don't also hand it to the browser.
              return;
            }

            console.warn(
              `[hyperstream-gateway] tool "${toolName}" not in registry — forwarding to browser`,
            );
          }
        } catch {
          /* malformed frame */
        }
      }
    }

    // Preserve the original frame type: forwarding a text frame as binary makes
    // the browser receive a Blob and silently fail to JSON.parse it.
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data, { binary: isBinary });
    }
  });

  openaiWs.on("error", (err: Error) => {
    console.error("[hyperstream-gateway] OpenAI WS error:", err.message);
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: "relay.error", message: err.message }));
    }
    browserWs.close(1011, "OpenAI WebSocket error");
  });

  openaiWs.on("close", (code, reason) => {
    console.log(`[hyperstream-gateway] OpenAI WS closed: ${code} ${reason}`);
    if (browserWs.readyState === WebSocket.OPEN || browserWs.readyState === WebSocket.CONNECTING) {
      browserWs.close(1000, "OpenAI connection closed");
    }
  });

  browserWs.on("message", (data: import("ws").RawData, isBinary: boolean) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;

        if (typeof msg.type === "string" && msg.type.startsWith("relay.")) {
          if (msg.type === "relay.tool_registry") {
            // The browser strips tool URLs before session.update reaches OpenAI,
            // so it sends the full definitions here for server-side execution.
            const incoming = (msg.tools as Array<Record<string, unknown>> | undefined) ?? [];
            for (const t of incoming) {
              const name = typeof t.name === "string" ? t.name : "";
              if (name) toolRegistry.set(name, toToolEntry(t));
            }
            console.log(
              `[hyperstream-gateway] relay.tool_registry merged: ${incoming.length} tools, total=${toolRegistry.size}`,
            );
          }
          return;
        }
      } catch {
        /* non-JSON */
      }
    }

    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(data, { binary: isBinary });
    }
  });

  browserWs.on("close", () => {
    if (openaiWs.readyState === WebSocket.OPEN || openaiWs.readyState === WebSocket.CONNECTING) {
      openaiWs.close();
    }
  });

  browserWs.on("error", (err: Error) => {
    console.error("[hyperstream-gateway] browser WS error:", err.message);
    openaiWs.close();
  });
}

export const hyperStreamRoute: VoiceGatewayRoute = {
  name: "hyperstream",
  match: (pathname) => (pathname === RELAY_PATH ? {} : null),
  preflight: () => (process.env.OPENAI_API_KEY ? null : "OPENAI_API_KEY not configured"),
  onConnection: handleConnection,
};
