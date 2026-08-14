/**
 * Route contract for the voice gateway.
 *
 * Every relay is a route rather than its own `upgrade` listener. With multiple
 * independent listeners on one HTTP server, each listener sees every upgrade
 * and cannot tell whether another one already claimed the socket — so a stray
 * `socket.destroy()` in one relay kills another relay's connection. A single
 * router removes that class of bug.
 */
import type { WebSocket } from "ws";

export interface VoiceGatewayContext {
  /** Parsed request URL; carries both the path and query params. */
  url: URL;
  /** Path params captured by the route matcher. */
  params: Record<string, string>;
  /** Base URL for server-to-server calls back into this app. */
  internalBaseUrl: () => string;
}

export interface VoiceGatewayRoute {
  name: string;
  /** Return captured params when this route owns the path, else null. */
  match(pathname: string): Record<string, string> | null;
  /**
   * Synchronous pre-upgrade validation. Return an error message to reject the
   * upgrade with 503 instead of completing the handshake.
   *
   * Must stay synchronous: awaiting before handleUpgrade makes reverse proxies
   * drop the socket.
   */
  preflight?(url: URL): string | null;
  onConnection(ws: WebSocket, ctx: VoiceGatewayContext): void;
}
