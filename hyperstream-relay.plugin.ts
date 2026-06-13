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
 * --- Server-side tool execution (deployed agents) ---
 * When the connection URL includes ?agentId=<uuid>, the relay switches into
 * "deployed mode": instead of forwarding response.function_call_arguments.done
 * events to the browser, it executes Cal.com booking tools server-to-server
 * and injects the result back into the OpenAI session via
 * conversation.item.create + response.create.
 *
 * This makes HyperStream booking work correctly for deployed agents where there
 * is no browser-side tool executor. Test calls in the builder do NOT include an
 * agentId, so they continue to use browser-side tool execution (no change to
 * that flow).
 */
import { WebSocket, WebSocketServer } from "ws";
import type { Plugin } from "vite";

const RELAY_PATH = "/api/hyperstream-relay";
const OPENAI_MODEL = "gpt-realtime";

/** Cal.com booking tool names → path segment on our public API. */
const BOOKING_TOOL_PATHS: Record<string, string> = {
  check_availability: "/api/public/hyperstream/availability",
  book_appointment: "/api/public/hyperstream/book",
  cancel_appointment: "/api/public/hyperstream/cancel",
  reschedule_appointment: "/api/public/hyperstream/reschedule",
  get_event_types: "/api/public/hyperstream/event-types",
};

/** Derive the internal base URL for server-to-server calls within the relay. */
function getInternalBase(port?: number): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return `http://localhost:${port ?? 5173}`;
}

/**
 * Execute a single booking tool server-to-server and return the result as a
 * plain string (JSON or error message).  `agentId` is always injected into
 * the args so the endpoint can resolve the right workspace.
 */
async function executeBookingTool(
  toolName: string,
  rawArgs: string,
  agentId: string,
  base: string,
): Promise<string> {
  const path = BOOKING_TOOL_PATHS[toolName];
  if (!path) throw new Error(`Unknown booking tool: ${toolName}`);

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    /* keep empty args */
  }
  args.agent_id = agentId;

  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: toolName, args }),
  });
  return res.text();
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
      const addressInfo = server.httpServer.address();
      if (addressInfo && typeof addressInfo === "object" && "port" in addressInfo) {
        devPort = (addressInfo as { port: number }).port;
      }

      server.httpServer.on("upgrade", (req, socket, head) => {
        try {
          // Parse URL to extract both the path and query params.
          // The upgrade handler must remain synchronous (no await) — the
          // Replit reverse-proxy drops the socket if handleUpgrade is deferred.
          const parsedUrl = new URL(req.url ?? "/", "http://localhost");
          const urlPath = parsedUrl.pathname;
          if (urlPath !== RELAY_PATH) return;

          // Phase 2: model selection routed through Core Runtime.
          // The client reads def.model.id, maps it to a realtime model name via
          // resolvedRealtimeModel(), and passes it as ?model=<name>.
          // The relay uses this instead of the hardcoded OPENAI_MODEL constant
          // so model selection flows: definition → client → relay → OpenAI WS URL.
          const modelParam = parsedUrl.searchParams.get("model") ?? OPENAI_MODEL;

          // Deployed-agent mode: when agentId is present the relay executes
          // Cal.com booking tool calls server-side instead of forwarding them to
          // the browser.  Test calls from the builder do not include agentId.
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
              `[hyperstream-relay] upgrading browser socket in deployed mode… model=${modelParam} agentId=${agentId}`,
            );
          } else {
            console.log(`[hyperstream-relay] upgrading browser socket… model=${modelParam}`);
          }

          const wss = new WebSocketServer({ noServer: true });
          wss.handleUpgrade(req, socket, head, (browserWs) => {
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
              // Fast-path: skip full JSON.parse for audio delta frames.
              // They arrive at ~20 ms intervals and are the hot path — parsing
              // every one just to suppress the log wastes CPU and GC.
              // We check with a cheap substring scan instead:
              //   '{"type":"response.output_audio.delta"' or '{"type":"response.audio.delta"'
              if (!isBinary) {
                const str = data.toString();
                const isAudioDelta =
                  str.indexOf('"response.output_audio.delta"') !== -1 ||
                  str.indexOf('"response.audio.delta"') !== -1;

                if (!isAudioDelta) {
                  try {
                    const msg = JSON.parse(str) as Record<string, unknown>;
                    console.log(`[hyperstream-relay] OpenAI → browser: ${JSON.stringify(msg).slice(0, 2000)}`);

                    // ── Server-side tool execution (deployed-agent mode) ──────────
                    // When agentId is present and the event is a completed function
                    // call, execute the tool server-to-server rather than forwarding
                    // to the browser.  This handles the case where no browser tab is
                    // driving the session (e.g. a production phone-number deployment).
                    if (
                      agentId &&
                      msg.type === "response.function_call_arguments.done"
                    ) {
                      const toolName = msg.name as string;
                      const callId = msg.call_id as string;
                      const rawArgs = (msg.arguments as string) ?? "{}";

                      if (BOOKING_TOOL_PATHS[toolName]) {
                        const internalBase = getInternalBase(devPort);
                        console.log(
                          `[hyperstream-relay] executing booking tool server-side: ${toolName} callId=${callId}`,
                        );

                        void (async () => {
                          try {
                            const result = await executeBookingTool(
                              toolName,
                              rawArgs,
                              agentId,
                              internalBase,
                            );

                            // Inject tool result back into the OpenAI session.
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

                            // Notify the browser (if connected) so the UI can display
                            // the tool activity without re-executing the tool.
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
                              `[hyperstream-relay] tool ${toolName} executed OK, result length=${result.length}`,
                            );
                          } catch (toolErr) {
                            const errMsg =
                              toolErr instanceof Error ? toolErr.message : String(toolErr);
                            console.error(
                              `[hyperstream-relay] tool execution failed for ${toolName}:`,
                              errMsg,
                            );

                            // Return an error result so the model can respond gracefully.
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

                        // Don't forward the raw function_call event to the browser —
                        // the relay.tool_executed event above is sent instead.
                        return;
                      }
                      // Unknown tool in deployed mode — fall through and forward to
                      // browser so any custom handler there can deal with it.
                    }
                  } catch {
                    /* malformed frame — skip */
                  }
                }
              }

              if (browserWs.readyState === WebSocket.OPEN) {
                // Forward with the correct frame type. OpenAI sends TEXT frames,
                // but the ws library delivers them as Buffer; sending a Buffer
                // without binary:false re-sends as a BINARY frame, which the
                // browser receives as a Blob and JSON.parse silently drops.
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
                  if (msg.type !== "input_audio_buffer.append") {
                    console.log(`[hyperstream-relay] browser → OpenAI: ${JSON.stringify(msg).slice(0, 300)}`);
                  }
                } catch { /* non-JSON */ }
              }
              if (openaiWs.readyState === WebSocket.OPEN) {
                // Forward with the correct frame type — without isBinary the ws
                // library treats Buffer payloads as binary frames, which OpenAI rejects.
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
