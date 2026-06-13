/**
 * Vite dev-server plugin: WebSocket relay for HyperStream (OpenAI Realtime) test calls.
 *
 * Browser connects to  ws(s)://<host>/api/hyperstream-relay
 * This plugin upgrades that connection and opens a mirror WS to
 *   wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17
 * using the server-side OPENAI_API_KEY, then relays all frames bidirectionally.
 *
 * Only active in the Vite dev server (configureServer hook).
 *
 * IMPORTANT: ws is imported at the top level so that the upgrade handler can
 * call handleUpgrade synchronously. If the import is deferred with
 * `await import("ws")` inside the async handler, the Replit reverse-proxy
 * drops the socket before handleUpgrade runs.
 *
 * --- Two relay modes ---
 *
 * 1. Proxy mode (no ?agentId)   — used by the builder test-call UI.
 *    The relay forwards all frames between the browser and OpenAI unchanged.
 *    Tool calls (response.function_call_arguments.done) are forwarded to the
 *    browser which executes them via executeToolCall() and sends back the
 *    function_call_output.  No changes to this path.
 *
 * 2. Deployed mode (?agentId=<uuid>) — used by production / phone agents
 *    where there is no browser-side executor.
 *    • The relay fetches the agent's full tool registry from the internal
 *      endpoint GET /api/internal/agent-tools/:id (admin client, no user auth).
 *    • The browser (if connected) can also push additional/updated tool defs
 *      via a relay.tool_registry message which the relay intercepts and merges.
 *    • When OpenAI fires response.function_call_arguments.done the relay:
 *        - Handles built-in tools (end_call, transfer_call) inline.
 *        - POSTs to the tool's url/api_url for custom webhook tools.
 *        - Injects conversation.item.create + response.create back into OpenAI.
 *        - Sends relay.tool_executed to the browser for UI display only.
 *      relay.* messages from the browser are never forwarded to OpenAI.
 */
import { WebSocket, WebSocketServer } from "ws";
import type { Plugin } from "vite";

const RELAY_PATH = "/api/hyperstream-relay";
const OPENAI_MODEL = "gpt-realtime";

interface ToolEntry {
  tool_type?: string;
  url?: string;
  api_url?: string;
}

/** Derive the internal base URL for server-to-server calls. */
function getInternalBase(port: number): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return `http://localhost:${port}`;
}

/**
 * Fetch the agent's full tool registry from the internal endpoint.
 * Returns a Map<toolName, ToolEntry> so the relay can execute any tool.
 */
async function fetchToolRegistry(
  agentId: string,
  base: string,
): Promise<Map<string, ToolEntry>> {
  const registry = new Map<string, ToolEntry>();
  try {
    const res = await fetch(`${base}/api/internal/agent-tools/${agentId}`, {
      headers: { "x-internal-relay": "true" },
    });
    if (!res.ok) {
      console.warn(
        `[hyperstream-relay] tool registry fetch failed: HTTP ${res.status} for agentId=${agentId}`,
      );
      return registry;
    }
    const json = (await res.json()) as { ok?: boolean; tools?: Array<Record<string, unknown>> };
    for (const t of json.tools ?? []) {
      const name = typeof t.name === "string" ? t.name : "";
      if (name) {
        registry.set(name, {
          tool_type: typeof t.tool_type === "string" ? t.tool_type : undefined,
          url: typeof t.url === "string" ? t.url : undefined,
          api_url: typeof t.api_url === "string" ? t.api_url : undefined,
        });
      }
    }
    console.log(
      `[hyperstream-relay] tool registry loaded: ${registry.size} tools for agentId=${agentId}`,
    );
  } catch (e) {
    console.warn(
      `[hyperstream-relay] tool registry fetch error for agentId=${agentId}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
  return registry;
}

/**
 * Execute a tool call using the registry entry.
 * Always resolves — errors are returned as a JSON error string so the
 * session can continue rather than hanging.
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
  } catch { /* keep empty */ }

  // Inject agent_id so the target endpoint can resolve the workspace.
  if (agentId) args.agent_id = agentId;

  // Built-in: end_call
  if (entry.tool_type === "end_call") {
    return JSON.stringify({ ended: true, message: "Call ended by agent." });
  }

  // Built-in: transfer_call
  if (entry.tool_type === "transfer_call") {
    const dest = args.destination ?? args.transfer_destination ?? "operator";
    return JSON.stringify({ transferred: true, destination: dest });
  }

  // Webhook / custom tool — POST to url or api_url.
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
      console.error(`[hyperstream-relay] webhook error for tool "${toolName}":`, msg);
      return JSON.stringify({ error: `Tool "${toolName}" webhook failed: ${msg}` });
    }
  }

  // No executor found — acknowledge so the session doesn't stall.
  return JSON.stringify({
    result: "acknowledged",
    tool: toolName,
    note: "Tool registered but no executor available.",
  });
}

export function hyperStreamRelayPlugin(): Plugin {
  return {
    name: "hyperstream-relay",

    configureServer(server) {
      if (!server.httpServer) {
        console.error("[hyperstream-relay] server.httpServer is null — plugin inactive");
        return;
      }
      console.log("[hyperstream-relay] registered on httpServer ✓");

      // Resolve dev-server port once so server-side fetch calls can target it.
      let devPort = 5173;
      server.httpServer.once("listening", () => {
        const addr = server.httpServer!.address();
        if (addr && typeof addr === "object" && "port" in addr) {
          devPort = (addr as { port: number }).port;
        }
      });

      server.httpServer.on("upgrade", (req, socket, head) => {
        try {
          // Parse URL to extract both the path and query params.
          // The upgrade handler must remain synchronous (no await) — the
          // Replit reverse-proxy drops the socket if handleUpgrade is deferred.
          const parsedUrl = new URL(req.url ?? "/", "http://localhost");
          const urlPath = parsedUrl.pathname;
          if (urlPath !== RELAY_PATH) return;

          const modelParam = parsedUrl.searchParams.get("model") ?? OPENAI_MODEL;

          // Deployed-agent mode: when agentId is present the relay handles all
          // tool calls server-side.  Test calls from the builder use agentRowId
          // (different param name) so they never trigger deployed mode.
          const agentId = parsedUrl.searchParams.get("agentId") ?? null;

          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) {
            console.error("[hyperstream-relay] OPENAI_API_KEY not configured");
            socket.write(
              "HTTP/1.1 503 Service Unavailable\r\n" +
                "Content-Type: text/plain\r\n\r\n" +
                "OPENAI_API_KEY not configured",
            );
            socket.destroy();
            return;
          }

          if (agentId) {
            console.log(
              `[hyperstream-relay] upgrading (deployed mode) model=${modelParam} agentId=${agentId}`,
            );
          } else {
            console.log(`[hyperstream-relay] upgrading (proxy mode) model=${modelParam}`);
          }

          const wss = new WebSocketServer({ noServer: true });
          wss.handleUpgrade(req, socket, head, (browserWs) => {
            // Per-session tool registry — populated from the internal endpoint
            // (agentId mode) and/or relay.tool_registry messages from the browser.
            const toolRegistry = new Map<string, ToolEntry>();

            // If in deployed mode, asynchronously load the tool registry.
            // This runs in the background; any function calls that arrive before
            // it completes will find an empty registry and return an error — in
            // practice the session.update + first response takes long enough that
            // the fetch always finishes in time.
            if (agentId) {
              const base = getInternalBase(devPort);
              void fetchToolRegistry(agentId, base).then((reg) => {
                for (const [name, entry] of reg) {
                  toolRegistry.set(name, entry);
                }
              });
            }

            console.log(`[hyperstream-relay] browser WS upgraded, connecting to OpenAI model=${modelParam}…`);
            const openaiWs = new WebSocket(
              `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(modelParam)}`,
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                },
              },
            );

            openaiWs.on("open", () => {
              console.log("[hyperstream-relay] OpenAI WS open — sending relay.connected");
              if (browserWs.readyState === WebSocket.OPEN) {
                browserWs.send(JSON.stringify({ type: "relay.connected" }));
              }
            });

            openaiWs.on("message", (data: import("ws").RawData, isBinary: boolean) => {
              if (!isBinary) {
                const str = data.toString();
                const isAudioDelta =
                  str.indexOf('"response.output_audio.delta"') !== -1 ||
                  str.indexOf('"response.audio.delta"') !== -1;

                if (!isAudioDelta) {
                  try {
                    const msg = JSON.parse(str) as Record<string, unknown>;
                    console.log(`[hyperstream-relay] OpenAI → browser: ${JSON.stringify(msg).slice(0, 2000)}`);

                    // ── Deployed mode: server-side tool execution ─────────────
                    // Intercept function call events and execute the tool here
                    // instead of forwarding to the browser (which may not exist).
                    if (
                      agentId &&
                      msg.type === "response.function_call_arguments.done"
                    ) {
                      const toolName = msg.name as string;
                      const callId = msg.call_id as string;
                      const rawArgs = (msg.arguments as string) ?? "{}";
                      const entry = toolRegistry.get(toolName);

                      if (entry) {
                        // Tool is known — execute server-side.
                        const base = getInternalBase(devPort);
                        console.log(
                          `[hyperstream-relay] executing tool server-side: "${toolName}" callId=${callId}`,
                        );
                        void (async () => {
                          try {
                            const result = await executeTool(toolName, rawArgs, entry, agentId);

                            if (openaiWs.readyState === WebSocket.OPEN) {
                              openaiWs.send(
                                JSON.stringify({
                                  type: "conversation.item.create",
                                  item: {
                                    type: "function_call_output",
                                    call_id: callId,
                                    output: result,
                                  },
                                }),
                              );
                              openaiWs.send(JSON.stringify({ type: "response.create" }));
                            }

                            // Notify the browser for UI display (not for re-execution).
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

                            console.log(
                              `[hyperstream-relay] tool "${toolName}" OK, resultLen=${result.length}`,
                            );

                            // end_call: close the session after the result is
                            // delivered so OpenAI can say goodbye.
                            if (entry.tool_type === "end_call") {
                              setTimeout(() => {
                                if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
                              }, 4000);
                            }
                          } catch (toolErr) {
                            const errMsg =
                              toolErr instanceof Error ? toolErr.message : String(toolErr);
                            console.error(
                              `[hyperstream-relay] tool "${toolName}" failed:`,
                              errMsg,
                            );
                            if (openaiWs.readyState === WebSocket.OPEN) {
                              openaiWs.send(
                                JSON.stringify({
                                  type: "conversation.item.create",
                                  item: {
                                    type: "function_call_output",
                                    call_id: callId,
                                    output: JSON.stringify({ error: errMsg }),
                                  },
                                }),
                              );
                              openaiWs.send(JSON.stringify({ type: "response.create" }));
                            }
                          }
                        })();

                        // Don't forward the raw function call to the browser.
                        return;
                      }

                      // Tool not found in registry — fall through and forward to
                      // browser so any custom handler there can deal with it.
                      console.warn(
                        `[hyperstream-relay] tool "${toolName}" not in registry — forwarding to browser`,
                      );
                    }
                  } catch { /* malformed frame */ }
                }
              }

              if (browserWs.readyState === WebSocket.OPEN) {
                browserWs.send(data, { binary: isBinary });
              }
            });

            openaiWs.on("error", (err: Error) => {
              console.error("[hyperstream-relay] OpenAI WS error:", err.message);
              if (browserWs.readyState === WebSocket.OPEN) {
                browserWs.send(
                  JSON.stringify({ type: "relay.error", message: err.message }),
                );
              }
              browserWs.close(1011, "OpenAI WebSocket error");
            });

            openaiWs.on("close", (code, reason) => {
              console.log(`[hyperstream-relay] OpenAI WS closed: ${code} ${reason}`);
              if (
                browserWs.readyState === WebSocket.OPEN ||
                browserWs.readyState === WebSocket.CONNECTING
              ) {
                browserWs.close(1000, "OpenAI connection closed");
              }
            });

            browserWs.on("message", (data: import("ws").RawData, isBinary: boolean) => {
              if (!isBinary) {
                try {
                  const msg = JSON.parse(data.toString()) as Record<string, unknown>;

                  // Intercept relay.* messages — they are for the relay itself and
                  // must never be forwarded to OpenAI which would reject them.
                  if (typeof msg.type === "string" && msg.type.startsWith("relay.")) {
                    if (msg.type === "relay.tool_registry") {
                      // Browser sends the full tool list (including URL fields
                      // stripped before session.update reaches OpenAI) so the relay
                      // can execute tools server-side even in proxy mode sessions.
                      const incoming = (msg.tools as Array<Record<string, unknown>> | undefined) ?? [];
                      for (const t of incoming) {
                        const name = typeof t.name === "string" ? t.name : "";
                        if (!name) continue;
                        toolRegistry.set(name, {
                          tool_type: typeof t.tool_type === "string" ? t.tool_type : undefined,
                          url: typeof t.url === "string" ? t.url : undefined,
                          api_url: typeof t.api_url === "string" ? t.api_url : undefined,
                        });
                      }
                      console.log(
                        `[hyperstream-relay] relay.tool_registry merged: ${incoming.length} tools, total=${toolRegistry.size}`,
                      );
                    }
                    // Don't forward any relay.* message to OpenAI.
                    return;
                  }

                  if (msg.type !== "input_audio_buffer.append") {
                    console.log(`[hyperstream-relay] browser → OpenAI: ${JSON.stringify(msg).slice(0, 300)}`);
                  }
                } catch { /* non-JSON */ }
              }

              if (openaiWs.readyState === WebSocket.OPEN) {
                openaiWs.send(data, { binary: isBinary });
              }
            });

            browserWs.on("close", () => {
              console.log("[hyperstream-relay] browser WS closed");
              if (
                openaiWs.readyState === WebSocket.OPEN ||
                openaiWs.readyState === WebSocket.CONNECTING
              ) {
                openaiWs.close();
              }
            });

            browserWs.on("error", (err: Error) => {
              console.error("[hyperstream-relay] browser WS error:", err.message);
              openaiWs.close();
            });
          });
        } catch (e) {
          console.error("[hyperstream-relay] upgrade handler error:", e);
          socket.destroy();
        }
      });
    },
  };
}
