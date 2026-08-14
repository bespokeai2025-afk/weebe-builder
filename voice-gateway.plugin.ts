/**
 * Vite dev-server plugin: mount the voice WebSocket gateways.
 *
 * This replaces four near-identical plugins (hyperstream-relay, el-voice-relay,
 * telephony-stream, frejun-stream) that each attached their own `upgrade`
 * listener and each held their own copy of the relay logic. The relays now live
 * in src/lib/voice/gateway so production can mount the very same code — see
 * scripts/prod-entry.mjs.
 *
 * The plugin is deliberately tiny: dev-only concerns belong here, everything
 * else belongs in the gateway modules.
 */
import type { Server as HttpServer } from "node:http";
import type { Plugin } from "vite";
import { mountVoiceGateways } from "./src/lib/voice/gateway/mount";

export function voiceGatewayPlugin(): Plugin {
  return {
    name: "voice-gateway",

    configureServer(server) {
      if (!server.httpServer) {
        // Middleware mode has no HTTP server of its own, so there is nothing to
        // attach to. Say so plainly: the old plugins used optional chaining and
        // then logged "ready", which hid the fact that they were inert.
        console.error(
          "[voice-gateway] server.httpServer is null — voice relays are INACTIVE in this dev server",
        );
        return;
      }

      // Vite types httpServer as `http.Server | Http2SecureServer`. WebSockets
      // are an HTTP/1.1 upgrade and `ws` has no HTTP/2 support, so only the
      // HTTP/1.1 server is ever a valid target here.
      mountVoiceGateways(server.httpServer as HttpServer);
    },
  };
}
