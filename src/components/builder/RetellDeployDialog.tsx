import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RetellWebClient } from "retell-client-js-sdk";
import { Phone, PhoneOff, Loader2, RefreshCw, DollarSign, Plus, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useBuilderStore } from "@/lib/builder/store";
import { exportAgentJson } from "@/lib/builder/export-conversation-flow";
import { importAgentJson } from "@/lib/builder/import-conversation-flow";
import {
  deployAgentToRetell,
  createRetellWebCall,
  fetchRetellAgent,
} from "@/lib/builder/retell.functions";
import { listMyAgents, upsertMyAgent, getMyAgentByRetellId } from "@/lib/agents/agents.functions";
import { getMySpend, recordTestCallCost } from "@/lib/auth/auth.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTotalCostPerMinute } from "@/lib/builder/pricing";

export function RetellDeployDialog() {
  const {
    nodes,
    edges,
    settings,
    variables,

    setSettings,
    setActiveNode,
    addTestCallSeconds,
    loadFlow,
  } = useBuilderStore();
  const [deploying, setDeploying] = useState<"create" | "update" | null>(null);
  const [calling, setCalling] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [loadOpen, setLoadOpen] = useState(false);
  const [loadId, setLoadId] = useState("");
  const [loading, setLoading] = useState(false);
  const clientRef = useRef<RetellWebClient | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const recordedCallRef = useRef(false);

  const deploy = useServerFn(deployAgentToRetell);
  const startCall = useServerFn(createRetellWebCall);
  const fetchAgent = useServerFn(fetchRetellAgent);
  const listAgents = useServerFn(listMyAgents);
  const upsertAgent = useServerFn(upsertMyAgent);
  const getAgentByRetellId = useServerFn(getMyAgentByRetellId);
  const fetchSpend = useServerFn(getMySpend);
  const recordCost = useServerFn(recordTestCallCost);
  const qc = useQueryClient();

  const spendQ = useQuery({
    queryKey: ["my-spend"],
    queryFn: () => fetchSpend(),
    refetchOnWindowFocus: false,
  });
  const spendLimitCents = spendQ.data?.spendLimitCents ?? 500;
  const spendUsedCents = spendQ.data?.spendUsedCents ?? 0;
  const overLimit = spendUsedCents >= spendLimitCents;

  const agentsQ = useQuery({
    queryKey: ["my-agents"],
    queryFn: () => listAgents(),
    enabled: loadOpen,
    refetchOnWindowFocus: false,
  });

  const hasAgent = Boolean(settings.agentId);

  useEffect(() => {
    return () => {
      clientRef.current?.stopCall();
      clientRef.current = null;
      setActiveNode(null);
    };
  }, [setActiveNode]);

  // Tick elapsed seconds while in a call.
  useEffect(() => {
    if (!inCall) return;
    const t = setInterval(() => {
      if (startedAtRef.current) {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 500);
    return () => clearInterval(t);
  }, [inCall]);

  async function handleDeploy(kind: "create" | "update") {
    setDeploying(kind);
    try {
      const agent = exportAgentJson(nodes, edges, settings, variables);
      const isUpdate = kind === "update";
      const CAL_PRESETS = new Set([
        "check_availability",
        "book_appointment",
        "reschedule_appointment",
        "cancel_appointment",
      ]);
      const calToolOverrides = nodes
        .filter(
          (n) =>
            n.data.kind === "function" &&
            typeof n.data.toolId === "string" &&
            CAL_PRESETS.has(n.data.toolId),
        )
        .map((n) => ({
          nodeId: n.id,
          preset: n.data.toolId as
            | "check_availability"
            | "book_appointment"
            | "reschedule_appointment"
            | "cancel_appointment",
          name: n.data.toolName,
          description: n.data.toolDescription,
          apiKey: n.data.toolApiKey,
          eventTypeId: n.data.toolEventTypeId,
          timezone: n.data.toolTimezone,
        }));
      const res = await deploy({
        data: {
          agent: agent as Record<string, unknown>,
          mode: kind,
          agentId: isUpdate ? settings.agentId || undefined : undefined,
          conversationFlowId: isUpdate ? settings.conversationFlowId || undefined : undefined,
          bookingConfig: settings.booking,
          calToolOverrides,
        },
      });
      setSettings({
        agentId: res.agentId,
        conversationFlowId: res.conversationFlowId,
      });
      await persistAgent(res.agentId);
      const bookingNote =
        settings.booking?.enabled === false
          ? "Booking disabled for this agent (no calendar tools attached)."
          : res.calendarConnected
            ? "Booking tools (check_availability / book_appointment / cancel_appointment) auto-attached."
            : "Calendar not connected — booking tools were NOT attached. Connect Cal.com in Settings → Calendar to enable bookings.";
      toast.success(isUpdate ? "Agent updated" : "Agent created", {
        description: `agent_id: ${res.agentId}\n${bookingNote}`,
      });
    } catch (e) {
      toast.error("Deploy failed", { description: (e as Error).message });
    } finally {
      setDeploying(null);
    }
  }

  async function handleTestCall() {
    const agentId = (settings.agentId ?? "").trim();
    if (!agentId.startsWith("agent_")) {
      toast.error("Deploy the agent first to get a valid agent ID");
      return;
    }
    setCalling(true);
    try {
      const { accessToken } = await startCall({ data: { agentId } });
      const client = new RetellWebClient();
      clientRef.current = client;

      client.on("call_started", () => {
        startedAtRef.current = Date.now();
        recordedCallRef.current = false;
        setElapsedSec(0);
        setInCall(true);
        // Highlight the start node immediately.
        const startNode = nodes.find((n) => n.data.isStart) ?? nodes[0];
        if (startNode) setActiveNode(startNode.id);
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

      client.on("error", (err: unknown) => {
        toast.error("Call error", {
          description: String((err as Error)?.message ?? err),
        });
        client.stopCall();
      });
      await client.startCall({ accessToken });
    } catch (e) {
      toast.error("Test call failed", { description: (e as Error).message });
    } finally {
      setCalling(false);
    }
  }

  function endCall() {
    recordCurrentCallCost();
    clientRef.current?.stopCall();
    clientRef.current = null;
    setInCall(false);
    setActiveNode(null);
    startedAtRef.current = null;
  }

  const costPerMinute = getTotalCostPerMinute(settings.model);
  const minutes = elapsedSec / 60;
  const cost = minutes * costPerMinute;
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");

  function recordCurrentCallCost() {
    if (recordedCallRef.current || !startedAtRef.current) return;
    const seconds = Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000));
    recordedCallRef.current = true;
    if (seconds <= 0) return;
    addTestCallSeconds(seconds);
    // Persist to server-side spend cap and refresh meter.
    recordCost({ data: { seconds } })
      .then((res) => {
        qc.setQueryData(["my-spend"], {
          spendLimitCents: res.spendLimitCents,
          spendUsedCents: res.spendUsedCents,
          email: spendQ.data?.email ?? "",
        });
        if (res.overLimit) {
          toast.warning("Spend cap reached", {
            description: `You've hit $${(res.spendLimitCents / 100).toFixed(2)}. Ask an admin to add credits.`,
          });
        }
      })
      .catch((e) => console.warn("recordTestCallCost failed:", (e as Error).message));
  }

  async function handleLoadById() {
    const id = loadId.trim();
    if (!id.startsWith("agent_")) {
      toast.error('Agent ID must start with "agent_"');
      return;
    }
    setLoading(true);
    try {
      const result = await fetchAgent({ data: { agentId: id } });
      if (!result.ok) {
        toast.error("Failed to load agent", { description: result.error });
        return;
      }
      const { agentJson } = result;
      const parsed = importAgentJson(agentJson);
      loadFlow(parsed);
      await persistAgent(id);
      toast.success("Agent loaded", { description: id });
      setLoadOpen(false);
      setLoadId("");
    } catch (e) {
      toast.error("Failed to load agent", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  /**
   * Save (or update) the current flow into the user's `agents` table so it
   * shows up in the "Your saved agents" list. Keyed by retell_agent_id.
   */
  async function persistAgent(retellAgentId: string) {
    try {
      const { nodes: n, edges: e, settings: s, variables: v } = useBuilderStore.getState();
      const existing = await getAgentByRetellId({ data: { retellAgentId } });
      await upsertAgent({
        data: {
          id: existing?.id,
          retellAgentId,
          name: s.agentName || "Untitled agent",
          flowData: { nodes: n, edges: e } as never,
          settings: s as never,
          variables: v as never,
        },
      });
      qc.invalidateQueries({ queryKey: ["my-agents"] });
    } catch (err) {
      console.warn("persistAgent failed:", (err as Error).message);
    }
  }

  return (
    <>
      {/* Test / Run agent — icon only */}
      {inCall ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={endCall}
          className="!h-7 !w-7 !p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          title="End test call"
        >
          <PhoneOff className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={handleTestCall}
          disabled={calling || !hasAgent || overLimit}
          className="!h-7 !w-7 !p-0 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200 disabled:opacity-40"
          title={
            overLimit
              ? `Spend cap reached ($${(spendUsedCents / 100).toFixed(2)} / $${(spendLimitCents / 100).toFixed(2)}).`
              : hasAgent
                ? "Test agent (browser call)"
                : "Deploy the agent first"
          }
        >
          {calling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Phone className="h-3.5 w-3.5" />
          )}
        </Button>
      )}

      {/* Load existing agent by ID — icon only */}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setLoadOpen(true)}
        className="!h-7 !w-7 !p-0"
        title="Load agent by ID"
      >
        <Download className="h-3.5 w-3.5" />
      </Button>

      {/* Update existing — icon only */}
      {hasAgent && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleDeploy("update")}
          disabled={deploying !== null}
          className="!h-7 !w-7 !p-0 text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
          title="Update existing agent with current flow"
        >
          {deploying === "update" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      )}

      {/* Create New Agent — primary icon CTA */}
      <Button
        size="sm"
        onClick={() => handleDeploy("create")}
        disabled={deploying !== null}
        className="!h-7 !w-7 !p-0 shadow-[0_0_0_1px_hsl(var(--primary)/0.3),0_6px_18px_-6px_hsl(var(--primary)/0.5)]"
        title="Create new agent from current flow"
      >
        {deploying === "create" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
      </Button>

      <Dialog open={loadOpen} onOpenChange={setLoadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load agent by ID</DialogTitle>
            <DialogDescription>
              Paste an agent ID (starts with <code>agent_</code>) to pull its conversation flow into
              the builder for editing.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="agent_xxxxxxxxxxxxxxxxxxxxxxxx"
            value={loadId}
            onChange={(e) => setLoadId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLoadById();
            }}
          />

          <div className="mt-1">
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              Your saved agents
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {agentsQ.isLoading ? (
                <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              ) : agentsQ.data && agentsQ.data.length > 0 ? (
                agentsQ.data
                  .filter((a) => a.retell_agent_id)
                  .map((a) => {
                    const isSelected = loadId.trim() === a.retell_agent_id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setLoadId(a.retell_agent_id ?? "")}
                        onDoubleClick={() => {
                          setLoadId(a.retell_agent_id ?? "");
                          // Defer to ensure state is set before submit.
                          setTimeout(() => handleLoadById(), 0);
                        }}
                        className={`w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors ${
                          isSelected ? "bg-muted" : ""
                        }`}
                      >
                        <div className="text-sm font-medium truncate">{a.name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono truncate">
                          {a.retell_agent_id}
                        </div>
                      </button>
                    );
                  })
              ) : (
                <div className="p-3 text-xs text-muted-foreground">
                  No saved agents yet. Create or deploy one to see it here.
                </div>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Click to fill the ID, double-click to load instantly.
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setLoadOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleLoadById} disabled={loading || !loadId.trim()}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1" />
              )}
              Load
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cost meter — server-tracked spend with per-account cap. */}
      {(inCall || spendUsedCents > 0) && (
        <div
          className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground/80 shadow-sm"
          title={`Total test-call spend @ $${costPerMinute.toFixed(2)}/min`}
        >
          {inCall && (
            <>
              <span className="inline-flex items-center gap-1 tabular-nums text-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                {mm}:{ss}
              </span>
              <span className="h-3 w-px bg-border" />
            </>
          )}
          <span className="inline-flex items-center gap-1 tabular-nums text-foreground">
            <DollarSign className="h-3 w-3 text-muted-foreground" />
            {(spendUsedCents / 100 + cost).toFixed(3)}
            <span className="text-muted-foreground"> / ${(spendLimitCents / 100).toFixed(2)}</span>
          </span>
          <span className="hidden lg:inline text-muted-foreground">
            {inCall ? `· live $${cost.toFixed(3)} ` : ""}· @ ${costPerMinute.toFixed(2)}/min
          </span>
        </div>
      )}
    </>
  );
}
