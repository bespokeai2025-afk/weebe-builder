/**
 * Hold a WebSocket's first messages while the connection is still being set up.
 *
 * Carriers send their opening frames the moment the socket opens — Twilio sends `connected` and
 * then `start` (which carries the streamSid and callSid) immediately. The bridges look up the call
 * and its credentials before attaching their message handler, and `ws` drops messages that arrive
 * with no listener. The `start` frame was lost that way, so the agent never began and the caller
 * heard silence. Call this as soon as the socket opens; once the real handler is attached, call the
 * returned function to replay what arrived in between, in order.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */
import type { WebSocket } from "ws";

export function holdEarlyMessages(ws: WebSocket): () => void {
  const held: unknown[][] = [];
  const hold = (...args: unknown[]) => {
    held.push(args);
  };
  ws.on("message", hold);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    ws.off("message", hold);
    for (const args of held.splice(0)) ws.emit("message", ...(args as [never]));
  };
}
