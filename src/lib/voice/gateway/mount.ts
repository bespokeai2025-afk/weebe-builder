/**
 * Mounts every voice WebSocket relay onto a Node HTTP server.
 *
 * The point of this module is that it takes a plain `http.Server`, so the exact
 * same relays run in both environments:
 *   - dev:  the Vite plugin passes `server.httpServer`
 *   - prod: an srvx plugin passes `server.node.server` (see scripts/prod-entry.mjs)
 *
 * Before this existed the relays were defined inside Vite `configureServer`
 * hooks, which never run in production — so HyperStream and telephony calls had
 * no WebSocket endpoint at all once deployed.
 */
import type { Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { WebSocketServer } from "ws";
import { registerLocalHttpServer } from "../lifecycle/webhook";
import { cascadeRoute } from "./cascade.gateway";
import { frejunRoute } from "./frejun.gateway";
import { hyperStreamRoute } from "./hyperstream.gateway";
import { telephonyRoute } from "./telephony.gateway";
import type { VoiceGatewayRoute } from "./types";

export const VOICE_GATEWAY_ROUTES: VoiceGatewayRoute[] = [
  hyperStreamRoute,
  cascadeRoute,
  telephonyRoute,
  frejunRoute,
];

export interface MountOptions {
  /** Port the app is listening on, used to build the internal base URL. */
  port?: number;
  routes?: VoiceGatewayRoute[];
}

/** Marker so repeated mounts (dev server restarts) don't stack listeners. */
const MOUNTED = Symbol.for("webee.voiceGatewayMounted");

/** Base URL for server-to-server calls back into this app. */
function resolveInternalBase(port: number): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return `http://localhost:${port}`;
}

function rejectUpgrade(socket: Duplex, status: string, body: string): void {
  socket.write(
    `HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${body}`,
  );
  socket.destroy();
}

/**
 * Attach the voice relays. Returns the routes that were mounted.
 *
 * Safe to call more than once on the same server: the second call is a no-op.
 */
export function mountVoiceGateways(
  httpServer: HttpServer,
  options: MountOptions = {},
): VoiceGatewayRoute[] {
  const target = httpServer as HttpServer & { [MOUNTED]?: boolean };
  if (target[MOUNTED]) return [];
  target[MOUNTED] = true;

  const routes = options.routes ?? VOICE_GATEWAY_ROUTES;

  // Resolve the real port once listening, so the internal base URL is correct
  // even when the port was 0 or reassigned.
  let port = options.port ?? 0;
  const readPort = () => {
    const addr = httpServer.address();
    if (addr && typeof addr === "object" && "port" in addr) {
      port = (addr as { port: number }).port;
    }
  };
  if (httpServer.listening) readPort();
  else httpServer.once("listening", readPort);

  // Lifecycle events are POSTed back into this same app, so the emitter needs to
  // know which port to reach. Loopback beats the public hostname here: it cannot
  // be broken by proxy or TLS config, and in a sandbox the public name often does
  // not resolve from inside the box.
  registerLocalHttpServer(httpServer);

  // One WebSocketServer for all routes: it only performs the handshake, so
  // there is no per-route state to keep separate.
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      return; // Not ours to reject — another listener may handle it.
    }

    for (const route of routes) {
      const params = route.match(url.pathname);
      if (!params) continue;

      try {
        const problem = route.preflight?.(url) ?? null;
        if (problem) {
          console.error(`[voice-gateway] ${route.name} rejected upgrade: ${problem}`);
          rejectUpgrade(socket, "503 Service Unavailable", problem);
          return;
        }

        // Must stay synchronous: awaiting here makes reverse proxies (Replit,
        // nginx) drop the socket before the handshake completes.
        wss.handleUpgrade(req, socket, head, (ws) => {
          try {
            route.onConnection(ws, {
              url,
              params,
              internalBaseUrl: () => resolveInternalBase(port),
            });
          } catch (err) {
            console.error(`[voice-gateway] ${route.name} connection error:`, err);
            ws.close(1011, "gateway error");
          }
        });
      } catch (err) {
        console.error(`[voice-gateway] ${route.name} upgrade error:`, err);
        socket.destroy();
      }
      return;
    }

    // No route matched: leave the socket alone. Vite's HMR listener and any
    // other consumer must still get their chance to handle it.
  });

  console.log(
    `[voice-gateway] mounted ${routes.length} routes: ${routes.map((r) => r.name).join(", ")}`,
  );
  return routes;
}
