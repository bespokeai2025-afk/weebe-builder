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
 */
import { WebSocket, WebSocketServer } from "ws";
import type { Plugin } from "vite";

const RELAY_PATH = "/api/hyperstream-relay";
const OPENAI_MODEL = "gpt-realtime";

export function hyperStreamRelayPlugin(): Plugin {
  return {
    name: "hyperstream-relay",

    configureServer(server) {
      if (!server.httpServer) {
        console.error("[hyperstream-relay] server.httpServer is null — plugin inactive");
        return;
      }
      console.log("[hyperstream-relay] registered on httpServer ✓");

      server.httpServer.on("upgrade", (req, socket, head) => {
        try {
          const urlPath = req.url?.split("?")[0] ?? "";
          if (urlPath !== RELAY_PATH) return;

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

          console.log("[hyperstream-relay] upgrading browser socket…");
          const wss = new WebSocketServer({ noServer: true });
          wss.handleUpgrade(req, socket, head, (browserWs) => {
            console.log("[hyperstream-relay] browser WS upgraded, connecting to OpenAI…");
            const openaiWs = new WebSocket(
              `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(OPENAI_MODEL)}`,
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
                  } catch { /* malformed frame — skip */ }
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
