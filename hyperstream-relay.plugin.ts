/**
 * Vite dev-server plugin: WebSocket relay for HyperStream (OpenAI Realtime) test calls.
 *
 * Browser connects to  ws(s)://<host>/api/hyperstream-relay
 * This plugin upgrades that connection and opens a mirror WS to
 *   wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17
 * using the server-side OPENAI_API_KEY, then relays all frames bidirectionally.
 *
 * Only active in the Vite dev server (configureServer hook).
 */
import type { Plugin } from "vite";

const RELAY_PATH = "/api/hyperstream-relay";
const OPENAI_MODEL = "gpt-4o-realtime-preview-2024-12-17";

export function hyperStreamRelayPlugin(): Plugin {
  return {
    name: "hyperstream-relay",

    configureServer(server) {
      server.httpServer?.on("upgrade", async (req, socket, head) => {
        try {
          const urlPath = req.url?.split("?")[0] ?? "";
          if (urlPath !== RELAY_PATH) return;

          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) {
            socket.write(
              "HTTP/1.1 503 Service Unavailable\r\n" +
                "Content-Type: text/plain\r\n\r\n" +
                "OPENAI_API_KEY not configured",
            );
            socket.destroy();
            return;
          }

          const { WebSocketServer, WebSocket } = await import("ws");

          const wss = new WebSocketServer({ noServer: true });
          wss.handleUpgrade(req, socket, head, (browserWs) => {
            const openaiWs = new WebSocket(
              `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(OPENAI_MODEL)}`,
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "OpenAI-Beta": "realtime=v1",
                },
              },
            );

            openaiWs.on("open", () => {
              if (browserWs.readyState === WebSocket.OPEN) {
                browserWs.send(JSON.stringify({ type: "relay.connected" }));
              }
            });

            openaiWs.on("message", (data: import("ws").RawData) => {
              if (browserWs.readyState === WebSocket.OPEN) {
                browserWs.send(data);
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

            openaiWs.on("close", () => {
              if (
                browserWs.readyState === WebSocket.OPEN ||
                browserWs.readyState === WebSocket.CONNECTING
              ) {
                browserWs.close(1000, "OpenAI connection closed");
              }
            });

            browserWs.on("message", (data: import("ws").RawData) => {
              if (openaiWs.readyState === WebSocket.OPEN) {
                openaiWs.send(data);
              }
            });

            browserWs.on("close", () => {
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
