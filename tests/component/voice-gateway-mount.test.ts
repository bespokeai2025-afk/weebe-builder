import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mountVoiceGateways } from "@/lib/voice/gateway/mount";
import type { VoiceGatewayRoute } from "@/lib/voice/gateway/types";

/** Start a listening HTTP server and resolve its port. */
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("mountVoiceGateways", () => {
  let server: Server;

  beforeEach(() => {
    server = createServer((_req, res) => res.end("ok"));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("routes an upgrade to the matching route with captured params", async () => {
    const seen: Array<{ params: Record<string, string>; query: string | null }> = [];
    const route: VoiceGatewayRoute = {
      name: "test",
      match: (pathname) => {
        const m = /^\/api\/test\/([a-z0-9-]+)$/.exec(pathname);
        return m ? { callId: m[1] } : null;
      },
      onConnection: (ws, ctx) => {
        seen.push({ params: ctx.params, query: ctx.url.searchParams.get("mode") });
        ws.send("hello");
      },
    };

    mountVoiceGateways(server, { routes: [route] });
    const port = await listen(server);

    const client = new WebSocket(`ws://127.0.0.1:${port}/api/test/abc-123?mode=proxy`);
    const message = await new Promise<string>((resolve, reject) => {
      client.on("message", (d) => resolve(d.toString()));
      client.on("error", reject);
    });

    expect(message).toBe("hello");
    expect(seen).toEqual([{ params: { callId: "abc-123" }, query: "proxy" }]);
    client.close();
  });

  it("rejects with 503 when preflight reports missing configuration", async () => {
    const onConnection = vi.fn();
    const route: VoiceGatewayRoute = {
      name: "needs-key",
      match: (pathname) => (pathname === "/api/needs-key" ? {} : null),
      preflight: () => "MISSING_API_KEY not configured",
      onConnection,
    };

    mountVoiceGateways(server, { routes: [route] });
    const port = await listen(server);

    const client = new WebSocket(`ws://127.0.0.1:${port}/api/needs-key`);
    const err = await new Promise<Error>((resolve) => client.on("error", resolve));

    // ws surfaces the non-101 response as an "Unexpected server response".
    expect(err.message).toMatch(/503|Unexpected server response/);
    expect(onConnection).not.toHaveBeenCalled();
  });

  it("leaves unmatched upgrades for other listeners, e.g. Vite HMR", async () => {
    // Regression guard: destroying non-matching sockets here would break HMR
    // and any other WebSocket consumer sharing the same HTTP server.
    const route: VoiceGatewayRoute = {
      name: "test",
      match: (pathname) => (pathname === "/api/voice" ? {} : null),
      onConnection: (ws) => ws.send("voice"),
    };
    mountVoiceGateways(server, { routes: [route] });

    // A second, unrelated consumer registered after the gateway.
    const otherWss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      if (new URL(req.url ?? "/", "http://x").pathname !== "/other") return;
      otherWss.handleUpgrade(req, socket, head, (ws) => ws.send("other"));
    });

    const port = await listen(server);

    const client = new WebSocket(`ws://127.0.0.1:${port}/other`);
    const message = await new Promise<string>((resolve, reject) => {
      client.on("message", (d) => resolve(d.toString()));
      client.on("error", reject);
    });

    expect(message).toBe("other");
    client.close();
    otherWss.close();
  });

  it("mounts only once so dev-server restarts do not stack listeners", async () => {
    const route: VoiceGatewayRoute = {
      name: "test",
      match: () => ({}),
      onConnection: () => {},
    };

    const first = mountVoiceGateways(server, { routes: [route] });
    const second = mountVoiceGateways(server, { routes: [route] });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(server.listenerCount("upgrade")).toBe(1);
  });

  it("registers all four production relays by default", () => {
    const mounted = mountVoiceGateways(server);
    expect(mounted.map((r) => r.name)).toEqual(["hyperstream", "cascade", "telephony", "frejun"]);
  });
});

describe("production relay route matching", () => {
  it("matches the documented paths and rejects near-misses", async () => {
    const { VOICE_GATEWAY_ROUTES } = await import("@/lib/voice/gateway/mount");
    const byName = Object.fromEntries(VOICE_GATEWAY_ROUTES.map((r) => [r.name, r]));

    expect(byName.hyperstream.match("/api/hyperstream-relay")).toEqual({});
    expect(byName.hyperstream.match("/api/hyperstream-relay/extra")).toBeNull();

    expect(byName.cascade.match("/api/el-voice-relay")).toEqual({});
    expect(byName.cascade.match("/api/el-voice")).toBeNull();

    expect(byName.telephony.match("/api/telephony/stream/call-42")).toEqual({
      callId: "call-42",
    });
    expect(byName.telephony.match("/api/telephony/stream/")).toBeNull();

    expect(byName.frejun.match("/api/frejun/stream/xyz")).toEqual({ callId: "xyz" });
    expect(byName.frejun.match("/api/frejun/stream")).toBeNull();
  });
});
