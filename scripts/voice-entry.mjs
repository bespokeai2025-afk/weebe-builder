// Voice worker: runs the voice WebSocket relays (HyperStream, cascade, Twilio, FreJun) in their
// own process, apart from the website.
//
// Why: with the relays inside the web server, every web deploy or crash dropped every live call.
// Here a web restart never touches calls, and this process drains on shutdown — it stops taking
// new calls and waits for live ones to finish (up to VOICE_DRAIN_TIMEOUT_MS) before exiting. Run
// two instances on different ports behind nginx so one keeps taking calls while the other drains.
//
//   VOICE_PORT=3001 VOICE_APP_BASE_URL=http://127.0.0.1:3000 node scripts/voice-entry.mjs
//
// Env:
//   VOICE_PORT              port to listen on (default 3001)
//   VOICE_HOST              interface (default 127.0.0.1 — nginx sits in front)
//   VOICE_APP_BASE_URL      the web app, for lifecycle webhooks + tool lookups (default http://127.0.0.1:3000)
//   VOICE_DRAIN_TIMEOUT_MS  max wait for live calls on shutdown (default 15 min)
//
// GET /healthz → { ok, draining, activeConnections, uptimeSec }

import { createServer } from "node:http";

// Mirrors scripts/prod-entry.mjs: the Supabase URL secrets have been saved with the wrong value
// before; normalise before the gateway bundle reads process.env.
const CANONICAL_SUPABASE_URL = "https://ugrsdmmztnfgeajhwhzy.supabase.co";
const isValidSupabaseUrl = (v) => typeof v === "string" && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v);
for (const key of ["VITE_SUPABASE_URL", "SUPABASE_URL"]) {
  if (!isValidSupabaseUrl(process.env[key])) process.env[key] = CANONICAL_SUPABASE_URL;
}

const port = Number(process.env.VOICE_PORT ?? 3001);
const host = process.env.VOICE_HOST ?? "127.0.0.1";
const appBaseUrl = (process.env.VOICE_APP_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const drainTimeoutMs = Number(process.env.VOICE_DRAIN_TIMEOUT_MS ?? 15 * 60_000);
const startedAt = Date.now();

const sockets = new Set();
let draining = false;

// Twilio's warm-transfer status callback for the destination leg. The transfer waits on an
// in-memory promise in whichever worker runs the call, so a worker that isn't holding this call
// answers 404 and nginx retries the other instance (proxy_next_upstream http_404 non_idempotent).
const WARM_TRANSFER_STATUS = /^\/api\/public\/telephony\/warm-transfer-status\/([^/]+)$/;

function handleWarmTransferStatus(req, res, callId) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("POST only");
    return;
  }
  if (!gateway.hasPendingWarmTransfer(callId)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, reason: "not on this worker" }));
    return;
  }
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 64_000) req.destroy();
  });
  req.on("end", () => {
    const status = new URLSearchParams(body).get("CallStatus") ?? "";
    if (status === "in-progress" || status === "answered") gateway.resolveWarmTransferAnswered(callId);
    else if (status) gateway.resolveWarmTransferSettled(callId, status);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
}

const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  const warm = WARM_TRANSFER_STATUS.exec(path);
  if (warm) {
    handleWarmTransferStatus(req, res, decodeURIComponent(warm[1]));
    return;
  }
  if (path === "/healthz") {
    res.writeHead(draining ? 503 : 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(
      JSON.stringify({
        ok: !draining,
        draining,
        activeConnections: sockets.size,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      }),
    );
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Voice worker: WebSocket endpoints only");
});

// While draining, refuse new calls with 503 (nginx then tries the other instance) but keep the
// port open, so live calls — and callbacks for them, like warm-transfer status — keep working.
// Runs before the gateway's own upgrade listener; rewriting the URL makes the gateway skip it.
server.prependListener("upgrade", (req, socket) => {
  if (!draining) return;
  req.url = "/__voice-worker-draining";
  socket.write("HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nDraining");
  socket.destroy();
});

// Count live call sockets (every upgrade is a call or a browser voice session).
server.on("upgrade", (req, socket) => {
  if (draining) return;
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});

const gateway = await import("../dist/voice-gateway.mjs");
gateway.mountVoiceGateways(server, { appBaseUrl });

server.listen(port, host, () => {
  console.log(`[voice-worker] listening on ${host}:${port} (app: ${appBaseUrl})`);
});

async function shutdown(signal) {
  if (draining) return;
  draining = true;
  console.log(`[voice-worker] ${signal}: draining ${sockets.size} live connection(s), no new calls accepted`);
  const deadline = Date.now() + drainTimeoutMs;
  while (sockets.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (sockets.size > 0) {
    console.warn(`[voice-worker] drain timeout — closing ${sockets.size} connection(s)`);
    for (const s of sockets) s.destroy();
  } else {
    console.log("[voice-worker] drained — exiting");
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
