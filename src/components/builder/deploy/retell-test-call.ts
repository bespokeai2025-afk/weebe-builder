/** Retell web test call (Retell's own client SDK). Moved out of RetellDeployDialog unchanged; see deploy/test-call-session.ts. */
import type { RetellWebClient } from "retell-client-js-sdk";
import { toast } from "sonner";
import type { TestCallSession } from "./test-call-session";

export async function runRetellTestCall(session: TestCallSession): Promise<void> {
  const {
    clearDebugEvents,
    clientRef,
    emitDebug,
    nodes,
    pushTranscript,
    recordCurrentCallCost,
    recordedCallRef,
    setActiveNode,
    setCalling,
    setElapsedSec,
    setInCall,
    settings,
    startCall,
    startedAtRef,
    testCallPrepRef,
    transcript,
  } = session;
  const agentId = (settings.agentId ?? "").trim();
  if (!agentId.startsWith("agent_")) {
    toast.error("Deploy the agent first to get a valid agent ID");
    return;
  }
  setCalling(true);
  try {
    const session = await startCall({
      data: {
        agentId,
        dynamicVariables: testCallPrepRef.current.variables,
      },
    });
    const { RetellWebClient } = await import("retell-client-js-sdk");
    const client = new RetellWebClient();
    clientRef.current = client;

    client.on("call_started", () => {
      startedAtRef.current = Date.now();
      recordedCallRef.current = false;
      setElapsedSec(0);
      pushTranscript([]);
      setInCall(true);
      // Highlight the start node immediately.
      const startNode = nodes.find((n) => n.data.isStart) ?? nodes[0];
      if (startNode) setActiveNode(startNode.id);
      clearDebugEvents();
      emitDebug("call", "Test call started", { nodeId: startNode?.id });
    });

    client.on("call_ended", () => {
      recordCurrentCallCost();
      setInCall(false);
      setActiveNode(null);
      startedAtRef.current = null;
      clientRef.current = null;
    });

    // Retell emits various event shapes — we look anywhere for a node id.
    const tryHighlightFromPayload = (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const obj = payload as Record<string, unknown>;
      const candidates = [
        obj.current_node_id,
        obj.node_id,
        (obj.node as Record<string, unknown> | undefined)?.id,
        (obj.metadata as Record<string, unknown> | undefined)?.current_node_id,
      ];
      for (const c of candidates) {
        if (typeof c === "string" && nodes.some((n) => n.id === c)) {
          setActiveNode(c);
          return;
        }
      }
    };

    // Listen to every event Retell may emit for flow transitions.
    const events = ["update", "metadata", "node_transition", "agent_node_transition"] as const;
    for (const ev of events) {
      // SDK typing is loose — cast to any to register dynamic events.
      (client as unknown as { on: (e: string, cb: (p: unknown) => void) => void }).on(
        ev,
        tryHighlightFromPayload,
      );
    }

    // Retell update event carries a running full-transcript array each time.
    // Shape: { transcript: Array<{ role: "agent"|"user", content: string }> }
    // Replace the whole array on each update — Retell manages ordering.
    (client as unknown as { on: (e: string, cb: (p: unknown) => void) => void }).on(
      "update",
      (payload: unknown) => {
        if (!payload || typeof payload !== "object") return;
        const obj = payload as Record<string, unknown>;
        const t = obj.transcript;
        if (!Array.isArray(t) || t.length === 0) return;
        pushTranscript(
          (t as Array<{ role: string; content: string }>).map((entry, i) => ({
            id: `retell-${i}`,
            role: entry.role === "agent" ? "agent" : "user",
            text: entry.content ?? "",
            partial: false,
          })),
        );
      },
    );

    // Live speaking indicators — show a partial bubble while the agent is
    // talking so the transcript feels live even before the `update` event
    // fires with the completed turn text.
    const retellClient = client as unknown as { on: (e: string, cb: () => void) => void };
    retellClient.on("agent_start_talking", () => {
      pushTranscript((prev) => {
        // Avoid duplicate partial bubbles if one already exists.
        const last = prev[prev.length - 1];
        if (last?.role === "agent" && last.partial) return prev;
        return [...prev, { id: "retell-agent-partial", role: "agent" as const, text: "…", partial: true }];
      });
    });
    retellClient.on("agent_stop_talking", () => {
      // Remove the placeholder — the imminent `update` event will push the
      // real completed text and replace the whole transcript array.
      pushTranscript((prev) => prev.filter((e) => e.id !== "retell-agent-partial"));
    });

    client.on("error", (err: unknown) => {
      toast.error("Call error", {
        description: String((err as Error)?.message ?? err),
      });
      client.stopCall();
    });
    // Retell v3 web calls may use the "gateway" transport instead of LiveKit, so pass what
    // create-web-call returned. The SDK still forwards `update` events when Retell sends them.
    await client.startCall({
      accessToken: session.accessToken,
      callId: session.callId,
      ...(session.transport ? { transport: session.transport as "livekit" | "gateway" } : {}),
      ...(session.url ? { url: session.url } : {}),
      ...(session.iceServers ? { iceServers: session.iceServers } : {}),
    });
  } catch (e) {
    toast.error("Test call failed", { description: (e as Error).message });
  } finally {
    setCalling(false);
  }
}
